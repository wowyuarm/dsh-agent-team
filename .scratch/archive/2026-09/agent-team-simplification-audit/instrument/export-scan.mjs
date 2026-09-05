#!/usr/bin/env node
// Per-export consumption scan: for each module, list named exports and count
// how many OTHER files reference each name (imports or qualified uses).
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { buildGraph } from "./graph.mjs";

const [repoDir, ...targets] = process.argv.slice(2);
const graph = buildGraph(repoDir);
const rel = (p) => path.relative(repoDir, p);

// Precompute: which names does each file import, and from where.
const importNamesByFile = new Map(); // importer -> [{name, fromAbs}]
for (const [file, deps] of graph.files) {
  const text = readFileSync(file, "utf8");
  const names = [];
  // import { A, B as C } from '...' / import type { ... } from '...'
  for (const m of text.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)) {
    const spec = m[2];
    for (const part of m[1].split(",")) {
      const name = part.split(/\s+as\s+/)[0].trim();
      if (name) names.push({ name, spec });
    }
  }
  importNamesByFile.set(file, names);
}

// Re-export edges: export { A, B } from 'spec' / export * from 'spec'.
const reExportsByFile = new Map(); // file -> [{names|null (wildcard), spec}]
for (const [file] of graph.files) {
  const text = readFileSync(file, "utf8");
  const edges = [];
  for (const m of text.matchAll(/export\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    const names = m[1].split(",").map((p) => p.split(/\s+as\s+/).map((s) => s.trim())).map(([orig, alias]) => alias ?? orig);
    edges.push({ names, spec: m[2] });
  }
  for (const m of text.matchAll(/export\s*\*\s*from\s*["']([^"']+)["']/g)) {
    edges.push({ names: null, spec: m[1] });
  }
  if (edges.length) reExportsByFile.set(file, edges);
}

function reExportSources(fromFile, spec, name, depth = 0) {
  if (depth > 4) return [];
  const resolved = resolveSpecStatic(fromFile, spec);
  if (!resolved) return [];
  const edges = reExportsByFile.get(resolved) ?? [];
  const out = [];
  for (const edge of edges) {
    if (edge.names === null || edge.names.includes(name)) {
      out.push(resolved);
      out.push(...reExportSources(resolved, edge.spec, name, depth + 1));
    }
  }
  return out;
}

function resolveSpecStatic(fromFile, spec) {
  if (spec.startsWith(".")) {
    const base = path.resolve(path.dirname(fromFile), spec);
    if (graph.files.has(base)) return base;
    for (const e of [".ts", ".tsx"]) if (graph.files.has(base + e)) return base + e;
    for (const e of [".ts", ".tsx"]) if (graph.files.has(path.join(base, `index${e}`))) return path.join(base, `index${e}`);
    return null;
  }
  return null;
}

const resolveSpec = (fromFile, spec) => {
  if (spec.startsWith(".")) {
    const base = path.resolve(path.dirname(fromFile), spec);
    if (graph.files.has(base)) return base;
    for (const e of [".ts", ".tsx"]) if (graph.files.has(base + e)) return base + e;
    for (const e of [".ts", ".tsx"]) if (graph.files.has(path.join(base, `index${e}`))) return path.join(base, `index${e}`);
    return null;
  }
  return null; // subpath imports handled below only if needed
};

for (const target of targets) {
  const targetAbs = [...graph.files.keys()].find((f) => rel(f).endsWith(target));
  if (!targetAbs) {
    console.log(`?? no graph file matches ${target}`);
    continue;
  }
  const text = readFileSync(targetAbs, "utf8");
  const exports = new Set();
  for (const m of text.matchAll(/export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+([A-Za-z0-9_]+)/g)) exports.add(m[1]);
  for (const m of text.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(",")) {
      const name = part.split(/\s+as\s+/).pop().trim();
      if (name && name !== "default") exports.add(name);
    }
  }
  console.log(`\n=== ${target} (${exports.size} named exports) ===`);
  const consumers = new Map(); // exportName -> Set<importer>
  for (const [file, names] of importNamesByFile) {
    if (file === targetAbs) continue;
    for (const { name, spec } of names) {
      const resolved = resolveSpec(file, spec);
      const sources = resolved === targetAbs ? [file] : reExportSources(file, spec, name);
      if (resolved !== targetAbs && !sources.includes(targetAbs)) continue;
      if (!consumers.has(name)) consumers.set(name, new Set());
      consumers.get(name).add(rel(file));
    }
  }
  for (const name of [...exports].sort()) {
    const c = consumers.get(name);
    console.log(c ? `  ${name}: ${c.size} consumer(s) -> ${[...c].join(", ")}` : `  ${name}: ZERO importers`);
  }
}
