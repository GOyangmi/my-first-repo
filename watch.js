const chokidar = require("chokidar");
const { execSync } = require("child_process");

const WATCH_PATH = ".";
const LM_URL = "http://127.0.0.1:1234/v1/chat/completions";
const MODEL = "qwen/qwen3.5-9b";

let isProcessing = false;
let lastHash = "";

function hash(str) {
  return require("crypto").createHash("md5").update(str).digest("hex");
}

// ==========================
// git diff
// ==========================
function getDiff() {
  try {
    execSync("git add .");
    return execSync("git diff --cached").toString();
  } catch {
    return "";
  }
}

// ==========================
// AI 분석
// ==========================
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
              "You are a senior software engineer. Return JSON ONLY like: {type, message}. type must be one of: feat, fix, refactor, chore. message must be short (max 12 words)."
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

    // JSON 파싱 안전 처리
    try {
      return JSON.parse(text);
    } catch {
      return {
        type: "chore",
        message: "auto update (AI fallback)"
      };
    }
  } catch {
    return {
      type: "chore",
      message: "auto update (fallback)"
    };
  }
}

// ==========================
// sync
// ==========================
async function sync() {
  if (isProcessing) return;
  isProcessing = true;

  console.log("\n🔄 Processing changes...");

  const diff = getDiff();
  if (!diff) {
    console.log("ℹ️ No changes");
    isProcessing = false;
    return;
  }

  // 🔥 무한 루프 방지 (diff hash 체크)
  const currentHash = hash(diff);
  if (currentHash === lastHash) {
    console.log("🛑 Duplicate change blocked");
    isProcessing = false;
    return;
  }
  lastHash = currentHash;

  // AI 분석
  const result = await analyzeDiff(diff);

  const commitMessage = `[${result.type}] ${result.message}`;

  console.log("🧠 AI:", commitMessage);

  try {
    execSync(`git commit -m "${commitMessage}"`);
    execSync("git push origin main");
    console.log("✅ PUSH SUCCESS");
  } catch (err) {
    console.log("❌ Git error:", err.message);
  }

  isProcessing = false;
}

// ==========================
// watcher
// ==========================
console.log("🚀 AI Git Watcher v6 Started");
console.log("📁 Watching:", WATCH_PATH);

chokidar.watch(WATCH_PATH, {
  ignored: ["node_modules", ".git", "dist", "build"],
  persistent: true,
  ignoreInitial: true
}).on("all", (event, path) => {
  console.log(`🔄 ${event}: ${path}`);
  sync();
});