import { execFileSync } from "node:child_process";

const git = (...args) =>
  execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const fail = (detail) => {
  console.error(`\nFrontend deployment blocked: ${detail}`);
  console.error(
    "Commit and push the UI changes to main, fetch origin/main, then deploy that exact commit.\n",
  );
  process.exit(1);
};

try {
  const dirtyFrontend = git(
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    ".",
  );
  if (dirtyFrontend) {
    fail("the frontend contains uncommitted changes");
  }

  // Refresh the remote ref inside the guard. A stale local origin/main must never authorize an
  // older worktree to replace the live Cloudflare bundle.
  execFileSync("git", ["fetch", "origin", "main", "--quiet"], {
    cwd: process.cwd(),
    stdio: "inherit",
  });

  const head = git("rev-parse", "HEAD");
  const productionSource = git("rev-parse", "origin/main");
  if (head !== productionSource) {
    fail(
      `this worktree is at ${head.slice(0, 7)}, but origin/main is ${productionSource.slice(0, 7)}`,
    );
  }

  console.log(`Frontend deploy source verified: origin/main@${head.slice(0, 7)}`);
} catch (error) {
  if (error?.status === 1) process.exit(1);
  fail(error instanceof Error ? error.message : "Git verification failed");
}
