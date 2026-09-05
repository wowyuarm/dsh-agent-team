#!/usr/bin/env node
// dsh deletion ablation: remove a target (repo-root-relative file or dir under
// packages/*/src) plus its reverse dependency closure, run the vitest suite
// directly against TS sources (no build). Generated lib/ artifacts and
// node_modules are symlinked from the caller's checkout into the worktree.
//
// Usage: node ablate-delete.mjs <repoDir> <targetRel> <outJson>
//   targetRel example: packages/agent-team/src/attachments.ts
import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { buildGraph, reverseClosure, listTsFiles } from "./graph.mjs";

const [repoDirRaw, targetRel, outJson] = process.argv.slice(2);
const repoDir = path.resolve(repoDirRaw);
const testCmd = process.env.ABLATION_TEST_CMD ?? "npx vitest run";
const slug = targetRel.replaceAll("/", "__").replaceAll(".", "_");
// Worktrees must live as a SIBLING of the repo: harness-dir.mjs resolves the
// harness checkout as ../deepseek-harness from the repo root, so a /tmp
// worktree cannot see it (symlink/env hacks break module singletons).
const worktrees = path.dirname(repoDir);
const wt = path.join(worktrees, `.dsh-ablation-${slug}`);

const fail = (json, stage, error) => {
  const result = { target: targetRel, mode: "deletion", stage, error: String(error).slice(0, 4000), ...json };
  mkdirSync(path.dirname(outJson), { recursive: true });
  writeFileSync(outJson, JSON.stringify(result, null, 2));
  console.error(`[${targetRel}] failed at ${stage}: ${String(error).slice(0, 400)}`);
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
  try {
    execSync(`git worktree add --detach "${wt}" HEAD`, { cwd: repoDir, stdio: "ignore" });
  } catch {
    execSync("git worktree prune", { cwd: repoDir, stdio: "ignore" });
    execSync(`git worktree add --detach "${wt}" HEAD`, { cwd: repoDir, stdio: "ignore" });
  }
  if (!existsSync(wt)) throw new Error(`worktree missing after add: ${wt}`);
  const nm = path.join(repoDir, "node_modules");
  if (existsSync(nm)) symlinkSync(nm, path.join(wt, "node_modules"));
  for (const pkg of existsSync(path.join(repoDir, "packages")) ? execSync("ls packages", { cwd: repoDir, encoding: "utf8" }).split("\n").filter(Boolean) : []) {
    const lib = path.join(repoDir, "packages", pkg, "lib");
    if (existsSync(lib)) symlinkSync(lib, path.join(wt, "packages", pkg, "lib"));
  }

  // 1. Closure from the worktree's own graph.
  const graph = buildGraph(wt);
  const srcTarget = path.join(wt, targetRel);
  let targets = [];
  try {
    targets = listTsFiles(srcTarget);
  } catch {}
  if (targets.length === 0 && existsSync(srcTarget)) targets = [srcTarget];
  if (targets.length === 0) throw new Error(`no target files under ${targetRel}`);
  const closure = reverseClosure(graph, targets);
  const rel = (p) => path.relative(wt, p);
  const isSrc = (p) => rel(p).startsWith("packages/") && rel(p).includes("/src/");
  const isTest = (p) => rel(p).includes("/tests/") || rel(p).startsWith("scripts/");
  const removedSrc = closure.filter(isSrc);
  const removedTest = closure.filter(isTest);

  // 2. Delete the collapse set.
  for (const f of closure) rmSync(f);

  // 3. Run surviving tests directly against TS sources.
  const run = spawnSync(testCmd, { cwd: wt, shell: true, encoding: "utf8", timeout: 1_800_000 });
  const out = (run.stdout ?? "") + (run.stderr ?? "");
  const summary = {};
  for (const m of out.matchAll(/Test Files\s+(\S+)\s*(?:\|\s*(\S+) passed)?\s*(?:\|\s*(\S+) skipped)?\s*\((\d+)\)/g)) {
    summary.testFilesFailed = summary.testFilesFailed ?? (m[1].includes("fail") ? Number(m[1].replace(/\D/g, "")) : 0);
    if (m[2]) summary.testFilesPassed = Number(m[2]);
  }
  for (const m of out.matchAll(/Test Files\s+(\d+)\s*failed\s*\|\s*(\d+)\s*passed/g)) {
    summary.testFilesFailed = Number(m[1]);
    summary.testFilesPassed = Number(m[2]);
  }
  for (const m of out.matchAll(/Test Files\s+(\d+)\s*passed/g)) {
    if (summary.testFilesFailed === undefined) summary.testFilesPassed = Number(m[1]);
  }
  for (const m of out.matchAll(/\n\s*Tests\s+(?:(\d+)\s*failed\s*\|\s*)?(\d+)\s*passed/g)) {
    summary.testsFailed = Number(m[1] ?? 0);
    summary.testsPassed = Number(m[2]);
  }
  const failures = [...out.matchAll(/^\s*FAIL\s+(\S+)/gm)].map((m) => m[1]);

  const result = {
    target: targetRel,
    mode: "deletion",
    removedSrcCount: removedSrc.length,
    removedTestCount: removedTest.length,
    removedSrc: removedSrc.map(rel),
    removedTest: removedTest.map(rel),
    testExitCode: run.status,
    ...summary,
    failingFiles: [...new Set(failures)],
    rawTail: out.slice(-8000),
  };
  mkdirSync(path.dirname(outJson), { recursive: true });
  writeFileSync(outJson, JSON.stringify(result, null, 2));
  const f = summary.testsFailed ?? "?";
  const p = summary.testsPassed ?? "?";
  console.log(`[${targetRel}] removed ${removedSrc.length} src / ${removedTest.length} test files; tests ${p} passed, ${f} failed (exit ${run.status})`);
} catch (error) {
  fail({}, "setup/run", error);
} finally {
  cleanup();
}
