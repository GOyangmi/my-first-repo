const chokidar = require("chokidar");
const { exec } = require("child_process");
const path = require("path");

const repoPath = process.cwd();

// 🔥 상태 관리
let isProcessing = false;
let lastHash = "";

// ⏱ debounce 타이머
let timer = null;

// 🚫 무시할 경로
const ignorePatterns = [
  "node_modules",
  ".git",
  "package-lock.json"
];

// -------------------------
// Git 실행 함수
// -------------------------
function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) reject(stderr || err);
      else resolve(stdout);
    });
  });
}

// -------------------------
// 실제 Git Sync
// -------------------------
async function gitSync() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    console.log("\n🔄 Processing changes...");

    // 1. add (필터링)
    await run(`git add .`);

    // 2. 상태 체크
    const status = await run("git status --porcelain");

    if (!status.trim()) {
      console.log("ℹ️ No real changes detected");
      isProcessing = false;
      return;
    }

    // 3. commit message
    const msg = `auto update ${new Date().toISOString()}`;

    console.log("🧠 Commit:", msg);

    await run(`git commit -m "${msg}"`);

    // 4. push
    await run("git push origin main");

    console.log("✅ PUSH SUCCESS");
  } catch (e) {
    console.error("❌ ERROR:", e);
  }

  isProcessing = false;
}

// -------------------------
// Watcher
// -------------------------
console.log("🚀 AI Safe Git Watcher v4 Started");
console.log("📁 Watching:", repoPath);

const watcher = chokidar.watch(repoPath, {
  ignored: (filePath) => {
    return ignorePatterns.some(p => filePath.includes(p));
  },
  persistent: true,
  ignoreInitial: true,
  awaitWriteFinish: {
    stabilityThreshold: 800,
    pollInterval: 100
  }
});

watcher.on("all", (event, filePath) => {
  console.log(`📌 ${event}: ${filePath}`);

  // debounce (핵심)
  clearTimeout(timer);
  timer = setTimeout(() => {
    gitSync();
  }, 1000);
});