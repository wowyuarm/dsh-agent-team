#!/usr/bin/env node
// dsh couple-map: per-file and per-directory coupling over packages/*/src,
// packages/*/tests, scripts/. Usage: node couple-map.mjs <repoDir> <outJson>
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { buildGraph, reverseClosure } from "./graph.mjs";

const [repoDir, outJson] = process.argv.slice(2);
const graph = buildGraph(repoDir);
const rel = (p) => path.relative(repoDir, p);
const isSrc = (p) => rel(p).startsWith("packages/") && rel(p).includes("/src/");
const isTest = (p) => rel(p).includes("/tests/") || rel(p).startsWith("scripts/");

const srcFiles = [...graph.files.keys()].filter(isSrc);
if (srcFiles.length === 0) throw new Error("no source files found under packages/*/src");

const directFanIn = (targetSet) => {
  const set = new Set(targetSet);
  const out = [];
  for (const [file, deps] of graph.files) {
    if (set.has(file)) continue;
    if (deps.some((d) => set.has(d))) out.push(file);
  }
  return out;
};

const fileRows = srcFiles.map((f) => {
  const closure = reverseClosure(graph, [f]);
  const fanIn = directFanIn([f]);
  const forwardDeps = new Set(graph.files.get(f) ?? []);
  return {
    file: rel(f),
    fanInSrc: fanIn.filter(isSrc).length,
    fanInTest: fanIn.filter(isTest).length,
    closureSize: closure.length,
    closureSrc: closure.filter(isSrc).length,
    forwardDeps: forwardDeps.size,
  };
});

const dirs = new Map();
for (const f of srcFiles) {
  const d = path.dirname(rel(f));
  dirs.set(d, (dirs.get(d) ?? 0) + 1);
}
const moduleRows = [...dirs.keys()].map((mod) => {
  const targets = srcFiles.filter((f) => path.dirname(rel(f)) === mod);
  const closure = reverseClosure(graph, targets);
  const fanIn = directFanIn(targets);
  return {
    module: mod,
    files: targets.length,
    directFanInSrc: fanIn.filter(isSrc).length,
    directFanInTest: fanIn.filter(isTest).length,
    closureSize: closure.length,
    closureSrc: closure.filter(isSrc).length,
    closureTest: closure.filter(isTest).length,
  };
});

fileRows.sort((a, b) => b.closureSize - a.closureSize || b.fanInSrc - a.fanInSrc);
moduleRows.sort((a, b) => b.closureSize - a.closureSize);
mkdirSync(path.dirname(outJson), { recursive: true });
writeFileSync(outJson, JSON.stringify({ files: fileRows, modules: moduleRows }, null, 2));
console.log("--- modules/dirs ---");
console.log(moduleRows
  .map((r) => `${r.module}: files=${r.files} srcFanIn=${r.directFanInSrc} testFanIn=${r.directFanInTest} closure=${r.closureSize} (src ${r.closureSrc} / test ${r.closureTest})`)
  .join("\n"));
console.log("--- top 25 files by closure ---");
console.log(fileRows.slice(0, 25)
  .map((r) => `${r.file}: fanInSrc=${r.fanInSrc} fanInTest=${r.fanInTest} closure=${r.closureSize} fwd=${r.forwardDeps}`)
  .join("\n"));
