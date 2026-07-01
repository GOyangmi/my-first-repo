const chokidar = require("chokidar");
const { execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const config = require("./config.json");

const LM_URL = config.lm_url;
const MODEL = config.model;
const PROJECTS = config.projects;

// ========================
// GLOBAL STATE
// ========================
let queue = [];
let processing = false;
let globalLock = false;

const debounceMap = new Map();
const MAX_DIFF_SIZE = 8000;
const DEBOUNCE_MS = 2000;
const MAX_RETRY = 2;

// ========================
// HASH
// ========================
function hash(str) {
  return crypto.createHash("md5").update(str).digest("hex");
}

// ========================
// SAFE GIT CHECK
// ========================
function isGitRepo(dir) {
  return fs.existsSync(path.join(dir, ".git"));
}

function isGitBusy(dir) {
  try {
    execSync("git status --porcelain", { cwd: dir, stdio: "pipe" });
    return false;
  } catch {
    return true;
  }
}

// ========================
// SAFE DIFF
// ========================
function getDiff(dir) {
  try {
    execSync("git add .", { cwd: dir, stdio: "ignore" });

    let diff = execSync("git diff --cached", {
      cwd: dir,
      encoding: "utf-8"
    });

    if (diff.length > MAX_DIFF_SIZE) {
      diff = diff.slice(0, MAX_DIFF_SIZE);
    }

    return diff;
  } catch {
    return "";
  }
}

// ========================
// AI CALL (SAFE)
// ========================
async function analyzeDiff(diff) {
  try {
    const res = await fetch(LM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              "Return ONLY JSON {type, message}. No markdown, no explanation."
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
    let text = data?.choices?.[0]?.message?.content || "";

    if (!text || !text.trim().startsWith("{")) {
      return null;
    }

    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ========================
// RETRY WRAPPER
// ========================
async function safeAnalyze(diff) {
  for (let i = 0; i < MAX_RETRY; i++) {
    const result = await analyzeDiff(diff);
    if (result) return result;
  }

  return { type: "chore", message: "auto update" };
}

// ========================
// PROCESS PROJECT
// ========================
async function processProject(dir) {
  if (!isGitRepo(dir)) return;
  if (isGitBusy(dir)) return;

  const diff = getDiff(dir);
  if (!diff) return;

  const key = hash(diff);

  const stateFile = path.join(dir, ".agent_state.json");
  let state = {};

  try {
    if (fs.existsSync(stateFile)) {
      state = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
    }
  } catch {}

  if (state.lastHash === key) return;

  state.lastHash = key;

  const result = await safeAnalyze(diff);

  const message = `[${result.type}] ${result.message}`;

  try {
    execSync(`git commit -m "${message}"`, { cwd: dir, stdio: "ignore" });
    execSync(`git push origin main`, { cwd: dir, stdio: "ignore" });

    console.log(`✅ ${path.basename(dir)} OK`);
  } catch (err) {
    console.log(`❌ ${path.basename(dir)} FAILED → retry later`);

    // 실패 복구 큐
    setTimeout(() => enqueue(dir), 5000);
  }

  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

// ========================
// QUEUE SYSTEM (STRICT)
// ========================
async function worker() {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const dir = queue.shift();
    await processProject(dir);
  }

  processing = false;
}

function enqueue(dir) {
  if (!queue.includes(dir)) {
    queue.push(dir);
  }
  worker();
}

// ========================
// DEBOUNCE (EVENT STORM FIX)
// ========================
function trigger(filePath) {
  clearTimeout(debounceMap.get(filePath));

  const t = setTimeout(() => {
    for (const dir of PROJECTS) {
      const fp = filePath.replaceAll("\\", "/");
      const d = dir.replaceAll("\\", "/");

      if (fp.startsWith(d)) {
        enqueue(dir);
      }
    }
  }, DEBOUNCE_MS);

  debounceMap.set(filePath, t);
}

// ========================
// START
// ========================
console.log("🚀 AI CENTRAL AGENT v7.3 (STABLE OPS MODE)");

for (const dir of PROJECTS) {
  console.log("📁 watching:", dir);

  chokidar.watch(dir, {
    ignored: ["node_modules", ".git", "dist", "build"],
    ignoreInitial: true
  }).on("all", (event, filePath) => {
    trigger(filePath);
  });
}