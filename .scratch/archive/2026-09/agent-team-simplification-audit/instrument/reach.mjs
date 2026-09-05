#!/usr/bin/env node
// Reachability from the repo's dynamic entry points. Prints source files
// NOT reachable from any entry (static dead-code candidates, pending
// dynamic-reference verification).
import path from "node:path";
import { buildGraph } from "./graph.mjs";

const [repoDir] = process.argv.slice(2);
const graph = buildGraph(repoDir);
const rel = (p) => path.relative(repoDir, p);

const entries = [
  "packages/agent-team/src/index.ts",
  "packages/agent-team/src/preset-roster.ts",
  "packages/agent-team/src/invariant.ts",
  "packages/agent-team/src/member-context.ts",
  "packages/tool-agent-team/src/index.ts",
  "packages/client-agent-team/src/index.ts",
  "packages/client-agent-team/src/client/index.ts",
];
// Vitest globs packages/*/tests/** as dynamic test roots; helpers hang off them.
for (const [file] of graph.files) {
  if (rel(file).includes("/tests/")) entries.push(rel(file));
}
const seen = new Set();
const queue = entries.map((e) => path.join(repoDir, e)).filter((e) => graph.files.has(e));
while (queue.length > 0) {
  const cur = queue.pop();
  if (seen.has(cur)) continue;
  seen.add(cur);
  for (const dep of graph.files.get(cur) ?? []) queue.push(dep);
}

const isSrcOrTest = (p) => rel(p).startsWith("packages/") && (rel(p).includes("/src/") || rel(p).includes("/tests/"));
const unreachable = [...graph.files.keys()].filter((f) => isSrcOrTest(f) && !seen.has(f));
console.log("--- entries ---");
console.log(entries.join("\n"));
console.log(`--- unreachable source/test files (${unreachable.length}) ---`);
console.log(unreachable.map(rel).sort().join("\n"));
