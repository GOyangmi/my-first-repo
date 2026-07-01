const chokidar = require("chokidar");
const { execSync } = require("child_process");
const crypto = require("crypto");

const WATCH_PATH = ".";
const LM_URL = "http://127.0.0.1:1234/v1/chat/completions";
const MODEL = "qwen/qwen3.5-9b";

let isProcessing = false;
let lastHash = "";

// =========================
// hash
// =========================
function hash(str) {
  return crypto.createHash("md5").update(str).digest("hex");
}

// =========================
// git diff
// =========================
function getDiff() {
  try {
    execSync("git add .");
    return execSync("git diff --cached").toString();
  } catch {
    return "";
  }
}

// =========================
// AI call (CLEAN)
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
              "Return ONLY JSON: {type, message}. No explanation, no reasoning."
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
// sync
// =========================
async function sync() {
  if (isProcessing) return;
  isProcessing = true;

  const diff = getDiff();
  if (!diff) {
    isProcessing = false;
    return;
  }

  const currentHash = hash(diff);
  if (currentHash === lastHash) {
    isProcessing = false;
    return;
  }
  lastHash = currentHash;

  const result = await analyzeDiff(diff);

  const message = `[${result.type}] ${result.message}`;

  // 🔥 CLEAN OUTPUT ONLY
  console.log("\n🔄 syncing...");
  console.log("🧠", message);

  try {
    execSync(`git commit -m "${message}"`, { stdio: "ignore" });
    execSync("git push origin main", { stdio: "ignore" });

    console.log("✅ pushed\n");
  } catch {
    console.log("❌ git error\n");
  }

  isProcessing = false;
}

// =========================
// watcher
// =========================
console.log("🚀 CLEAN AI Watcher Started");
console.log("📁", WATCH_PATH);

chokidar.watch(WATCH_PATH, {
  ignored: ["node_modules", ".git", "dist", "build"],
  persistent: true,
  ignoreInitial: true
}).on("all", () => sync());