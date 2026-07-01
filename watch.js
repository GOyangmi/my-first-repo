const chokidar = require("chokidar");
const { exec } = require("child_process");
const path = require("path");

const repoPath = __dirname;

console.log("🚀 AI Safe Git Watcher v3 Started");
console.log("📁 Watching:", repoPath);

// debounce + 중복 방지
let timer = null;
let isRunning = false;

function runGit() {
  if (isRunning) return;
  isRunning = true;

  console.log("\n🔄 Detected changes → syncing git...");

  exec("git status --porcelain", { cwd: repoPath }, (err, stdout) => {
    if (!stdout.trim()) {
      console.log("ℹ️ No real changes");
      isRunning = false;
      return;
    }

    exec("git add -A", { cwd: repoPath }, (err) => {
      if (err) {
        console.error("git add error:", err);
        isRunning = false;
        return;
      }

      const msg = `auto update ${new Date().toISOString()}`;

      exec(`git commit -m "${msg}"`, { cwd: repoPath }, (err) => {
        if (err) {
          console.log("ℹ️ Nothing to commit");
          isRunning = false;
          return;
        }

        exec("git push origin main", { cwd: repoPath }, (err) => {
          if (err) {
            console.error("❌ push failed:", err.message);
          } else {
            console.log("✅ PUSH SUCCESS");
          }

          isRunning = false;
        });
      });
    });
  });
}

chokidar.watch(repoPath, {
  ignored: [
    "node_modules/**",
    ".git/**",
    "**/dist/**",
    "**/.env"
  ],
  ignoreInitial: true,
}).on("all", () => {
  clearTimeout(timer);
  timer = setTimeout(runGit, 2000);
});