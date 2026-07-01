const chokidar = require("chokidar");
const { execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const config = require("./config.json");

const LM_URL = config.lm_url;
const MODEL = config.model;
const PROJECTS = config.projects;

// =========================
// STATE (CORE SAFETY)
// =========================
let queue = [];
let processing = false;
let systemLocked = false;

const debounceMap = new Map();
const runningDirs = new Set();

const MAX_DIFF_SIZE = 8000;
const DEBOUNCE_MS = 2000;
const MAX_RETRY = 2;

// =========================
// LOG SYSTEM
// =========================
const LOG_FILE = path.join(__dirname, "agent.log");

function log(type, msg, data = "") {
  const line = `[${new Date().toISOString()}] [${type}] ${msg} ${data}\n`;
  fs.appendFileSync(LOG_FILE, line);
  console.log(line.trim());
}

// =========================
// UTILS
// =========================
function hash(str) {
  return crypto.createHash("md5").update(str).digest("hex");
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// =========================
// GIT SAFETY CHECK
// =========================
function isGitRepo(dir) {
  return fs.existsSync(path.join(dir, ".git"));
}

function isGitLocked(dir) {
  try {
    execSync("git status --porcelain", { cwd: dir, stdio: "pipe" });
    return false;
  } catch {
    return true;
  }
}

// =========================
// DIFF SAFE
// =========================
function getDiff(dir) {
  try {
    execSync("git add .", { cwd: dir, stdio: "ignore" });

    let diff = execSync("git diff --cached", {
      cwd: dir,
      encoding: "utf8"
    });

    if (!diff) return "";
    if (diff.length > MAX_DIFF_SIZE) diff = diff.slice(0, MAX_DIFF_SIZE);

    return diff;
  } catch (e) {
    log("ERROR", "diff_failed", e.message);
    return "";
  }
}

// =========================
// AI CALL (HARD SAFE)
// =========================
async function callAI(diff) {
  try {
    const res = await fetch(LM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content: `
You are a git decision agent.

Return ONLY valid JSON:

{
  "action": "commit | skip | retry | fix",
  "message": "short message",
  "reason": "explanation"
}

Rules:
- skip: trivial or lock files
- commit: meaningful change
- retry: uncertain output
- fix: repo instability detected
`
          },
          {
            role: "user",
            content: diff
          }
        ],
        temperature: 0.2
      })
    });

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || "";

    if (!text || !text.trim().startsWith("{")) {
      log("WARN", "AI_INVALID_RESPONSE", text);
      return null;
    }

    return JSON.parse(text);
  } catch (e) {
    log("ERROR", "AI_FAILED", e.message);
    return null;
  }
}

// =========================
// SAFE DECISION WRAPPER
// =========================
function safeDecision(d) {
  if (!d || typeof d !== "object") {
    return { action: "skip", message: "fallback", reason: "null" };
  }

  if (!d.action) {
    return { action: "skip", message: "no-action", reason: "invalid-schema" };
  }

  return d;
}

// =========================
// GIT RECOVERY
// =========================
function gitRecovery(dir) {
  try {
    log("RECOVERY", "git reset/clean");

    execSync("git reset --hard", { cwd: dir, stdio: "ignore" });
    execSync("git clean -fd", { cwd: dir, stdio: "ignore" });

    log("RECOVERY_OK", dir);
  } catch (e) {
    log("RECOVERY_FAIL", e.message);
  }
}

// =========================
// EXECUTE ACTION
// =========================
async function execute(dir, decision) {
  log("DECISION", JSON.stringify(decision));

  if (decision.action === "skip") {
    log("SKIP", dir);
    return;
  }

  if (decision.action === "retry") {
    log("RETRY", dir);
    setTimeout(() => enqueue(dir), 3000);
    return;
  }

  if (decision.action === "fix") {
    log("FIX", dir);
    gitRecovery(dir);
    queue = [];
    processing = false;
    return;
  }

  if (decision.action === "commit") {
    try {
      execSync(`git commit -m "${decision.message}"`, {
        cwd: dir,
        stdio: "ignore"
      });

      execSync(`git push origin main`, {
        cwd: dir,
        stdio: "ignore"
      });

      log("SUCCESS", "commit+push");
    } catch (e) {
      log("ERROR", "git_failed");
      gitRecovery(dir);

      setTimeout(() => enqueue(dir), 5000);
    }
  }
}

// =========================
// PROCESS CORE
// =========================
async function processProject(dir) {
  if (systemLocked) return;
  if (!isGitRepo(dir)) return;
  if (isGitLocked(dir)) return;

  if (runningDirs.has(dir)) return;
  runningDirs.add(dir);

  try {
    const diff = getDiff(dir);
    if (!diff) return;

    const key = hash(diff);

    const stateFile = path.join(dir, ".agent_state.json");
    let state = {};

    try {
      if (fs.existsSync(stateFile)) {
        state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      }
    } catch {}

    if (state.lastHash === key) {
      log("SKIP_DUPLICATE", dir);
      return;
    }

    state.lastHash = key;

    const ai = await callAI(diff);
    const decision = safeDecision(ai);

    await execute(dir, decision);

    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  } catch (e) {
    log("FATAL", e.message);
    systemLocked = true;

    setTimeout(() => {
      systemLocked = false;
      log("UNLOCK", "system recovered");
    }, 5000);
  } finally {
    runningDirs.delete(dir);
  }
}

// =========================
// QUEUE SYSTEM
// =========================
function enqueue(dir) {
  if (!queue.includes(dir)) queue.push(dir);
  worker();
}

async function worker() {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const dir = queue.shift();
    await processProject(dir);
  }

  processing = false;
}

// =========================
// DEBOUNCE (EVENT CONTROL)
// =========================
function trigger(filePath) {
  clearTimeout(debounceMap.get(filePath));

  const t = setTimeout(() => {
    for (const dir of PROJECTS) {
      if (filePath.replaceAll("\\", "/").startsWith(dir.replaceAll("\\", "/"))) {
        enqueue(dir);
      }
    }
  }, DEBOUNCE_MS);

  debounceMap.set(filePath, t);
}

// =========================
// START
// =========================
console.log("🚀 v8.3 STABLE SELF-HEALING AGENT STARTED");

for (const dir of PROJECTS) {
  log("WATCH", dir);

  chokidar.watch(dir, {
    ignored: ["node_modules", ".git", "dist", "build"],
    ignoreInitial: true
  }).on("all", (event, filePath) => {
    trigger(filePath);
  });
}