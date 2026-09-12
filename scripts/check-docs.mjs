// Mechanical gate for the maintained documentation set.
//
// docs/AGENTS.md states the rules this file decides: maintained documents ship
// as bilingual pairs with a working switcher, every relative link resolves, and
// the index in docs/README.md and docs/README.zh.md names exactly the documents
// that exist. Humans forget those rules silently; this script is the part that
// cannot be forgotten.
//
// It deliberately runs standalone — no Harness checkout, no Vitest config — so a
// documentation edit can be checked in a second: `npm run check:docs`, which is
// also part of `npm test`. `--root <dir>` points the same checks at another tree
// (used to exercise the failure paths against throwaway copies).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// AGENTS.md files are single-language by rule (docs/AGENTS.md), so they are not
// part of the pairing check; everything else under docs/ is a maintained doc.
const SINGLE_LANGUAGE = new Set(['AGENTS.md'])
// The entry-point index describes where a reader should start: it lists neither
// itself nor the routing rules it points at.
const NOT_INDEXED = new Set(['AGENTS.md', 'README.md'])
// Each language's index links to its own side of the pair.
const INDEXES = [
  { name: 'README.md', heading: '## Documentation entry points' },
  { name: 'README.zh.md', heading: '## 文档入口' },
]
const SWITCHER_LINES = 6

const args = process.argv.slice(2)
const rootFlag = args.indexOf('--root')
const root = rootFlag === -1 ? repositoryRoot : resolve(args[rootFlag + 1] ?? '.')
const docsDirectory = join(root, 'docs')

const failures = []
const fail = (file, message) => failures.push(`${relative(root, file).replaceAll('\\', '/')}: ${message}`)

function markdownFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...markdownFiles(path))
    else if (entry.name.endsWith('.md')) files.push(path)
  }
  return files
}

const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g

// Relative targets only: external URLs, other schemes, and in-page anchors are
// out of scope for a repository-local resolution check.
function relativeTargets(text) {
  const targets = []
  for (const match of text.matchAll(linkPattern)) {
    const target = match[1].trim().replace(/^<|>$/g, '')
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) continue
    const path = target.split('#', 1)[0].split('?', 1)[0]
    if (path) targets.push(path)
  }
  return targets
}

// docs/README.zh.md links to the Chinese side of each pair; both indexes are
// compared on the English document name they name.
function documentName(target) {
  const path = target.replace(/^\.\//, '')
  return path.endsWith('.zh.md') ? `${path.slice(0, -'.zh.md'.length)}.md` : path
}

function sectionLines(text, heading) {
  const lines = text.replaceAll('\r\n', '\n').split('\n')
  const start = lines.indexOf(heading)
  if (start === -1) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(line => line.startsWith('## '))
  return end === -1 ? rest : rest.slice(0, end)
}

if (!existsSync(docsDirectory) || !statSync(docsDirectory).isDirectory()) {
  console.error(`Documentation check failed: no docs directory at ${docsDirectory}`)
  process.exit(1)
}

const files = markdownFiles(docsDirectory).sort()
const english = new Set()
const chinese = new Set()
for (const file of files) {
  const name = relative(docsDirectory, file).replaceAll('\\', '/')
  if (name.endsWith('.zh.md')) chinese.add(`${name.slice(0, -'.zh.md'.length)}.md`)
  else english.add(name)
}

// 1. Bilingual pairing and switcher integrity.
for (const name of english) {
  const file = join(docsDirectory, name)
  if (SINGLE_LANGUAGE.has(name)) continue
  const pairName = `${name.slice(0, -'.md'.length)}.zh.md`
  if (!chinese.has(name)) {
    fail(file, `maintained document has no Chinese pair (expected docs/${pairName})`)
    continue
  }
  const pairFile = join(docsDirectory, pairName)
  const head = readFileSync(file, 'utf8').replaceAll('\r\n', '\n').split('\n').slice(0, SWITCHER_LINES)
  const switcher = head.find(line => /^English \| \[中文\]\([^)]+\)$/.test(line))
  if (switcher === undefined) fail(file, `missing the English → 中文 switcher line ("English | [中文](${pairName})")`)
  else if (!switcher.includes(`](${pairName})`)) fail(file, `switcher does not point at ${pairName}: ${switcher}`)

  const pairHead = readFileSync(pairFile, 'utf8').replaceAll('\r\n', '\n').split('\n').slice(0, SWITCHER_LINES)
  const pairSwitcher = pairHead.find(line => /^\[English\]\([^)]+\) \| 中文$/.test(line))
  if (pairSwitcher === undefined) fail(pairFile, `missing the 中文 → English switcher line ("[English](${name}) | 中文")`)
  else if (!pairSwitcher.includes(`](${name})`)) fail(pairFile, `switcher does not point back at ${name}: ${pairSwitcher}`)
}
for (const name of chinese) {
  if (!english.has(name)) fail(join(docsDirectory, `${name.slice(0, -'.md'.length)}.zh.md`), 'translated pair has no English source document')
}

// 2. Relative links resolve inside the working tree.
let linkCount = 0
for (const file of files) {
  for (const target of relativeTargets(readFileSync(file, 'utf8'))) {
    linkCount += 1
    let path
    try {
      path = decodeURIComponent(target)
    } catch {
      fail(file, `link target is not valid percent-encoding: ${target}`)
      continue
    }
    if (!existsSync(resolve(dirname(file), path))) fail(file, `broken relative link: ${target}`)
  }
}

// 3. Both indexes name the same maintained documents, and exactly the ones that exist.
const actual = new Set([...english].filter(name => !NOT_INDEXED.has(name)))
const rowsByIndex = new Map()
for (const { name, heading } of INDEXES) {
  const file = join(docsDirectory, name)
  if (!existsSync(file)) {
    fail(file, 'documentation index is missing')
    continue
  }
  const section = sectionLines(readFileSync(file, 'utf8'), heading)
  if (section === null) {
    fail(file, `no "${heading}" section to compare`)
    continue
  }
  const rows = new Set()
  for (const line of section) {
    if (!line.startsWith('|')) continue
    for (const target of relativeTargets(line)) rows.add(documentName(target))
  }
  rowsByIndex.set(name, rows)
  for (const document of actual) if (!rows.has(document)) fail(file, `index is missing a row for ${document}`)
  for (const document of rows) if (!actual.has(document)) fail(file, `index names ${document}, which is not a maintained document`)
}
const englishRows = rowsByIndex.get('README.md')
const chineseRows = rowsByIndex.get('README.zh.md')
if (englishRows !== undefined && chineseRows !== undefined) {
  for (const document of englishRows) {
    if (!chineseRows.has(document)) fail(join(docsDirectory, 'README.zh.md'), `listed in the English index but missing here: ${document}`)
  }
  for (const document of chineseRows) {
    if (!englishRows.has(document)) fail(join(docsDirectory, 'README.md'), `listed in the Chinese index but missing here: ${document}`)
  }
}

if (failures.length > 0) {
  console.error(`Documentation check failed (${failures.length}):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(
  `Documentation check OK: ${actual.size} maintained documents, ${actual.size} bilingual pairs, `
  + `${linkCount} relative links resolved, both indexes agree.`,
)
