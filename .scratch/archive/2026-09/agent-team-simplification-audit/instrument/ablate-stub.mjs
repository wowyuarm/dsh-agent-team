#!/usr/bin/env node
// dsh stub ablation: worktree + symlink generated lib/ + node_modules, apply a
// source replacement to a factory/class body, run the vitest suite directly.
// Usage: node ablate-stub.mjs <repoDir> <fileRel> <matchRegex> <replacement> <outJson>
import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const [repoDirRaw, fileRel, match, replacement, outJson] = process.argv.slice(2);
const repoDir = path.resolve(repoDirRaw);
const testCmd = process.env.ABLATION_TEST_CMD ?? "npx vitest run";
const slug = "stub__" + fileRel.replaceAll("/", "__").replaceAll(".", "_");
// Worktrees must live as a SIBLING of the repo: harness-dir.mjs resolves the
// harness checkout as ../deepseek-harness from the repo root, so a /tmp
// worktree cannot see it (symlink/env hacks break module singletons).
const worktrees = path.dirname(repoDir);
const wt = path.join(worktrees, `.dsh-ablation-${slug}`);
const target = path.join(wt, fileRel);

const fail = (json, stage, error) => {
  const result = { target: fileRel, mode: "stub", stage, error: String(error).slice(0, 4000), ...json };
  mkdirSync(path.dirname(outJson), { recursive: true });
  writeFileSync(outJson, JSON.stringify(result, null, 2));
  console.error(`[${fileRel}] failed at ${stage}: ${String(error).slice(0, 400)}`);
  cleanup();
  process.exit(1);
};

function cleanup() {
  try {
    execSync(`git worktree remove --force "${wt}"`, { cwd: repoDir, stdio: "ignore" });
  } catch {}
  try {
    execSync("git worktree prune", { cwd: repoDir, stdio: "ignore" });
  } catch {}
}

try {
  rmSync(wt, { recursive: true, force: true });
  mkdirSync(worktrees, { recursive: true });
  execSync("git worktree prune", { cwd: repoDir, stdio: "ignore" });
  execSync(`git worktree add --detach "${wt}" HEAD`, { cwd: repoDir, stdio: "ignore" });
  if (!existsSync(wt)) throw new Error(`worktree missing after add: ${wt}`);
  symlinkSync(path.join(repoDir, "node_modules"), path.join(wt, "node_modules"));
  for (const pkg of execSync("ls packages", { cwd: repoDir, encoding: "utf8" }).split("\n").filter(Boolean)) {
    const lib = path.join(repoDir, "packages", pkg, "lib");
    if (existsSync(lib)) symlinkSync(lib, path.join(wt, "packages", pkg, "lib"));
  }

  // 1. Apply the stub replacement; verify the marker landed.
  const original = readFileSync(target, "utf8");
  const re = new RegExp(match, "s");
  if (!re.test(original)) throw new Error(`pattern not found in ${fileRel}: ${match.slice(0, 120)}`);
  const marker = `ABLATION_STUB_${Date.now()}`;
  const stubbed = original.replace(re, replacement.replace("$$MARKER$$", `'${marker}'`));
  if (!stubbed.includes(marker)) throw new Error("stub marker missing after replacement");
  writeFileSync(target, stubbed);

  // 2. Run the suite.
  const run = spawnSync(testCmd, { cwd: wt, shell: true, encoding: "utf8", timeout: 1_800_000 });
  const out = (run.stdout ?? "") + (run.stderr ?? "");
  const summary = {};
  for (const m of out.matchAll(/\n\s*Tests\s+(?:(\d+)\s*failed\s*\|\s*)?(\d+)\s*passed/g)) {
    summary.testsFailed = Number(m[1] ?? 0);
    summary.testsPassed = Number(m[2]);
  }
  const failures = [...out.matchAll(/^\s*FAIL\s+(\S+)/gm)].map((m) => m[1]);
  const result = {
    target: fileRel,
    mode: "stub",
    testExitCode: run.status,
    ...summary,
    failingFiles: [...new Set(failures)],
    rawTail: out.slice(-8000),
  };
  mkdirSync(path.dirname(outJson), { recursive: true });
  writeFileSync(outJson, JSON.stringify(result, null, 2));
  console.log(`[${fileRel}] stubbed; tests ${summary.testsPassed ?? "?"} passed, ${summary.testsFailed ?? "?"} failed (exit ${run.status})`);
} catch (error) {
  fail({}, "setup/run", error);
} finally {
  cleanup();
}
