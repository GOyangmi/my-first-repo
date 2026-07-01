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
// STATE
// =========================
let queue = [];
let processing = false;
let debounceTimer = null;

const DEBOUNCE_MS = 1500;

// =========================
// utils
// =========================
function hash(str) {
  return crypto.createHash("md5").update(str).digest("hex");
}

function isGitRepo(dir) {
  return fs.existsSync(path.join(dir, ".git"));
}

// =========================
// git diff
// =========================
function getDiff(dir) {
  try {
    execSync("git add .", { cwd: dir });
    return execSync("git diff --cached", { cwd: dir }).toString();
  } catch {
    return "";
  }
}

// =========================
// AI CALL
// =========================
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
              "Return ONLY JSON: {type, message}. No explanation."
          },
          {
            role: "user",
            content: diff.slice(0, 8000)
          }
        ],
        temperature: 0.2
      })
    });

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || "";

    try {
      return JSON.parse(text);
    } catch {
      return { type: "chore", message: "auto update" };
    }
  } catch {
    return { type: "chore", message: "auto update" };
  }
}

// =========================
// PROCESS ONE PROJECT
// =========================
async function processProject(dir) {
  if (!isGitRepo(dir)) return;

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

  // 중복 방지
  if (state.lastHash === key) return;

  state.lastHash = key;

  const result = await analyzeDiff(diff);

  const message = `[${result.type}] ${result.message}`;

  try {
    execSync(`git commit -m "${message}"`, { cwd: dir });
    execSync("git push origin main", { cwd: dir });

    console.log(`✅ [${path.basename(dir)}] pushed`);
  } catch {
    console.log(`❌ [${path.basename(dir)}] git error`);
  }

  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

// =========================
// QUEUE WORKER
// =========================
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
// QUEUE PUSH
// =========================
function enqueue(dir) {
  if (!queue.includes(dir)) {
    queue.push(dir);
  }

  worker();
}

// =========================
// DEBOUNCE TRIGGER
// =========================
function trigger(filePath) {
  clearTimeout(debounceTimer);

  debounceTimer = setTimeout(() => {
    for (const dir of PROJECTS) {
      const normalized = dir.replaceAll("\\", "/");
      const fp = filePath.replaceAll("\\", "/");

      if (fp.startsWith(normalized)) {
        enqueue(dir);
      }
    }
  }, DEBOUNCE_MS);
}

// =========================
// START
// =========================
console.log("🚀 AI CENTRAL AGENT v7 STABLE STARTED");

for (const dir of PROJECTS) {
  console.log("📁 watching:", dir);

  chokidar.watch(dir, {
    ignored: ["node_modules", ".git", "dist", "build"],
    ignoreInitial: true
  }).on("all", (event, filePath) => {
    console.log("🔄 change detected:", filePath);
    trigger(filePath);
  });
}