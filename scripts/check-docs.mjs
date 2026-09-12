// Mechanical gate for the maintained documentation set.
//
// docs/AGENTS.md states the rules this file decides: maintained documents ship
// as bilingual pairs with a working switcher, every relative link resolves, and
// the index in docs/README.md and docs/README.zh.md names exactly the documents
// that exist. Humans forget those rules silently; this script is the part that
// cannot be forgotten.
//
// It covers every bilingual page that ships: the maintained documents under
// docs/ plus the four README pairs (repository root and one per package). The
// set comparison stays docs-only, because those two READMEs are the only
// indexes.
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

// A switcher contract is the exact shape of the first lines, with `{source}` and
// `{pair}` standing for the two file names. The shapes genuinely differ — the
// repository README says "简体中文" and also links its own English page — so each
// page set states its own instead of being normalized into one wording.
const DOCS_SWITCHER = {
  english: 'English | [中文]({pair})',
  chinese: '[English]({source}) | 中文',
}

// `docs` enumerates: every Markdown file there is a maintained document unless
// it is single-language. A README set names its page instead, so an unrelated
// future Markdown file inside a package directory is not silently promoted into
// the pairing rule.
const PAGE_SETS = [
  { directory: 'docs', switcher: DOCS_SWITCHER, enumerate: true, skip: SINGLE_LANGUAGE },
  { directory: '.', pages: ['README.md'], switcher: {
    english: '[English]({source}) | [简体中文]({pair})',
    chinese: '[English]({source}) | 简体中文',
  } },
  { directory: 'packages/agent-team', pages: ['README.md'], switcher: DOCS_SWITCHER },
  { directory: 'packages/tool-agent-team', pages: ['README.md'], switcher: DOCS_SWITCHER },
  { directory: 'packages/client-agent-team', pages: ['README.md'], switcher: DOCS_SWITCHER },
]

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

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const fillSwitcher = (template, source, pair) =>
  template.replaceAll('{source}', source).replaceAll('{pair}', pair)

// The same template with each placeholder widened to any link: a switcher that
// points somewhere else is still recognized as a switcher, so the failure names
// the wrong target instead of claiming the line is missing.
const switcherDetectors = new Map()
function switcherDetector(template) {
  let detector = switcherDetectors.get(template)
  if (detector === undefined) {
    const widened = escapeRegExp(template)
      .replaceAll('\\{source\\}', '([^)]+)')
      .replaceAll('\\{pair\\}', '([^)]+)')
    detector = new RegExp(`^${widened}$`)
    switcherDetectors.set(template, detector)
  }
  return detector
}

function checkSwitcher(file, template, names) {
  const expected = fillSwitcher(template, names.source, names.pair)
  const detector = switcherDetector(template)
  const head = readFileSync(file, 'utf8').replaceAll('\r\n', '\n').split('\n').slice(0, SWITCHER_LINES)
  const line = head.find(candidate => detector.test(candidate))
  if (line === undefined) fail(file, `missing the switcher line (expected "${expected}")`)
  else if (line !== expected) fail(file, `switcher does not name its pair: ${line} (expected "${expected}")`)
}

if (!existsSync(docsDirectory) || !statSync(docsDirectory).isDirectory()) {
  console.error(`Documentation check failed: no docs directory at ${docsDirectory}`)
  process.exit(1)
}

// 1. Bilingual pairing and switcher integrity, in every page set.
const linkFiles = new Set()
let readmePairs = 0
for (const set of PAGE_SETS) {
  const directory = join(root, set.directory)
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    fail(directory, 'document set directory is missing')
    continue
  }
  const prefix = set.directory === '.' ? '' : `${set.directory}/`
  const names = set.enumerate
    ? markdownFiles(directory).map(file => relative(directory, file).replaceAll('\\', '/')).sort()
    : set.pages
  for (const name of names) {
    if (set.skip?.has(name)) {
      linkFiles.add(join(directory, name))
      continue
    }
    if (name.endsWith('.zh.md')) {
      const sourceName = `${name.slice(0, -'.zh.md'.length)}.md`
      if (!existsSync(join(directory, sourceName))) {
        fail(join(directory, name), 'translated pair has no English source document')
      }
      linkFiles.add(join(directory, name))
      continue
    }
    const source = join(directory, name)
    const pairName = `${name.slice(0, -'.md'.length)}.zh.md`
    const pair = join(directory, pairName)
    linkFiles.add(source)
    if (!existsSync(source)) {
      fail(source, 'maintained document is missing')
      continue
    }
    if (!existsSync(pair)) {
      fail(source, `maintained document has no Chinese pair (expected ${prefix}${pairName})`)
      continue
    }
    linkFiles.add(pair)
    if (!set.enumerate) readmePairs += 1
    checkSwitcher(source, set.switcher.english, { source: name, pair: pairName })
    checkSwitcher(pair, set.switcher.chinese, { source: name, pair: pairName })
  }
}

// 2. Relative links resolve inside the working tree.
let linkCount = 0
for (const file of [...linkFiles].sort()) {
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
const actual = new Set()
for (const file of markdownFiles(docsDirectory)) {
  const name = relative(docsDirectory, file).replaceAll('\\', '/')
  if (!name.endsWith('.zh.md') && !NOT_INDEXED.has(name)) actual.add(name)
}
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
  + `${readmePairs} README pairs, ${linkCount} relative links resolved, both indexes agree.`,
)
