// watch.js (v2 auto git sync system)

const chokidar = require("chokidar");
const { exec } = require("child_process");
const path = require("path");

const repoPath = __dirname;

console.log("🚀 Auto Git Watcher Started...");
console.log("📁 Watching:", repoPath);

// debounce (연속 변경 방지)
let timer = null;

function runGit() {
  console.log("\n🔄 Changes detected. Running git sync...");

  exec("git add .", { cwd: repoPath }, (err) => {
    if (err) return console.error("git add error:", err);

    const msg = `auto update ${new Date().toISOString()}`;

    exec(`git commit -m "${msg}"`, { cwd: repoPath }, (err, stdout) => {
      if (err) {
        console.log("ℹ️ Nothing to commit (clean state)");
        return;
      }

      console.log(stdout);

      exec("git push origin main", { cwd: repoPath }, (err, stdout) => {
        if (err) {
          console.error("❌ push failed:", err.message);
          return;
        }

        console.log("✅ PUSH SUCCESS");
      });
    });
  });
}

// 파일 변경 감지
chokidar.watch(repoPath, {
  ignored: /node_modules|\.git/,
  persistent: true,
  ignoreInitial: true,
}).on("all", () => {
  clearTimeout(timer);
  timer = setTimeout(runGit, 2000);
});