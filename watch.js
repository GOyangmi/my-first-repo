const chokidar = require("chokidar");
const { exec, execSync } = require("child_process");
const fs = require("fs");

const repoPath = __dirname;

console.log("🚀 AI Git Watcher v4 Started (LM Studio AI mode)");
console.log("📁 Watching:", repoPath);

// 상태 제어
let timer = null;
let isRunning = false;

// -----------------------------
// 1. 실제 변경 여부 체크
// -----------------------------
function hasRealChange() {
  try {
    const status = execSync("git status --porcelain", {
      cwd: repoPath,
    }).toString();

    return status.trim().length > 0;
  } catch {
    return false;
  }
}

// -----------------------------
// 2. git diff 가져오기
// -----------------------------
function getDiff() {
  try {
    return execSync("git diff --cached", {
      cwd: repoPath,
    }).toString();
  } catch {
    return "";
  }
}

// -----------------------------
// 3. LM Studio AI 호출
// -----------------------------
async function generateCommitMessage(diff) {
  try {
    const res = await fetch("http://localhost:1234/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "local-model",
        messages: [
          {
            role: "system",
            content:
              "You are a developer assistant. Generate short git commit messages.",
          },
          {
            role: "user",
            content: `Summarize this git diff into a short commit message:\n\n${diff}`,
          },
        ],
        temperature: 0.2,
      }),
    });

    const data = await res.json();
    return (
      data.choices?.[0]?.message?.content?.trim() ||
      "auto update (no AI message)"
    );
  } catch (e) {
    return "auto update (AI fallback)";
  }
}

// -----------------------------
// 4. Git 실행
// -----------------------------
async function runGit() {
  if (isRunning) return;
  isRunning = true;

  console.log("\n🔄 Processing changes...");

  if (!hasRealChange()) {
    console.log("ℹ️ No real changes detected");
    isRunning = false;
    return;
  }

  try {
    // stage
    execSync("git add -A", { cwd: repoPath });

    // diff
    const diff = getDiff().slice(0, 3000); // 너무 길면 제한

    // AI 메시지 생성
    const msg = await generateCommitMessage(diff);

    console.log("🧠 AI Commit Message:", msg);

    // commit
    execSync(`git commit -m "${msg.replace(/"/g, "'")}"`, {
      cwd: repoPath,
    });

    // push
    execSync("git push origin main", { cwd: repoPath });

    console.log("✅ PUSH SUCCESS");
  } catch (err) {
    console.log("ℹ️ Nothing to commit or error");
  }

  isRunning = false;
}

// -----------------------------
// 5. watcher
// -----------------------------
chokidar
  .watch(repoPath, {
    ignored: [
      "node_modules/**",
      ".git/**",
      "**/dist/**",
      "**/.env",
      "**/*.log",
    ],
    ignoreInitial: true,
  })
  .on("all", () => {
    clearTimeout(timer);
    timer = setTimeout(runGit, 4000);
  });