// UI parity audit: mechanical consistency checks between the Team Client's
// own CSS/TSX and the DSH 0.1.5 design language documented in
// docs/frontend-design.md §Design language alignment. This is the repeatable
// form of the manual audit that produced commit bb1ebba — run it after any
// visible-UI change and after every DSH upgrade:
//
//   node scripts/audit-ui-parity.mjs
//
// The script is intentionally a static text audit: it reads the Team Client
// sources and the harness checkout (through the shared harness-dir.mjs
// pointer), applies the documented language rules, and prints a report.
// Design judgment stays in docs; the script only reports mechanical drift.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { harnessDir } from './harness-dir.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const clientDir = join(root, 'packages/client-agent-team/src/client')
const shippedDir = join(harnessDir, 'packages/client')

const findings = []
const note = (severity, where, what) => findings.push({ severity, where, what })

// ---------------------------------------------------------------------------
// Language rules (keep in sync with docs/frontend-design.md §Design language
// alignment — the document is the authority, this table is its executable
// mirror).
// ---------------------------------------------------------------------------

const LANGUAGE = {
  iconButtonDiameter: 28,
  sendButtonDiameter: 34,
  rowRadius: 8,
  chipRadius: 6,
  controlGap: 12,
  focusRing: '2px solid var(--dsw-alias-label-primary)',
  // A focus ring must be visible: an `outline: none` with no paired visible
  // replacement (background, box-shadow, color, underline) is a violation.
  // listbox/aria-activedescendant option rows are exempt (focus stays on the
  // text input; the selected row is highlighted via aria-selected).
}

// Interactive classes that intentionally have no :focus-visible rule. Each
// entry must name the pattern that provides the visible selection feedback.
const FOCUS_EXEMPT = new Map([
  // Composer mention popup options: role="listbox" driven by
  // aria-activedescendant on the textarea — options never take keyboard
  // focus, the highlighted row is styled via [aria-selected='true'].
  ['mentionOption', 'aria-activedescendant listbox row (selection, not focus)'],
])

// ---------------------------------------------------------------------------
// 1. Focus visibility: every interactive class (cursor: pointer) needs a
//    focus-visible rule or a documented exemption.
// ---------------------------------------------------------------------------

function collectRules(css) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({
    selector: match[1].trim(),
    body: match[2],
  }))
}

for (const file of readdirSync(clientDir).filter(name => name.endsWith('.module.css'))) {
  const css = readFileSync(join(clientDir, file), 'utf8')
  const rules = collectRules(css)
  const interactive = new Set()
  for (const rule of rules) {
    if (/cursor:\s*pointer/.test(rule.body)) {
      for (const selector of rule.selector.split(',')) {
        const cls = selector.trim().match(/^\.([A-Za-z0-9_-]+)/)
        if (cls) interactive.add(cls[1])
      }
    }
  }
  const focused = new Set()
  for (const rule of rules) {
    if (/:focus-visible/.test(rule.selector)) {
      for (const match of rule.selector.matchAll(/\.([A-Za-z0-9_-]+)/g)) focused.add(match[1])
    }
  }
  for (const cls of interactive) {
    if (!focused.has(cls) && !FOCUS_EXEMPT.has(cls)) {
      note('warn', `${file} .${cls}`, 'interactive class without any :focus-visible rule')
    } else if (!focused.has(cls) && FOCUS_EXEMPT.has(cls)) {
      note('info', `${file} .${cls}`, `exempt (${FOCUS_EXEMPT.get(cls)})`)
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Bare outline suppression: an outline removal must pair a ring-grade
//    replacement in the same rule body. Background/color/opacity alone is
//    hover feedback, not a focus indicator — shipped keeps the UA ring on
//    small controls rather than substituting a hover fill.
// ---------------------------------------------------------------------------

const RING_GRADE = [
  /outline\s*:\s*(?!\s*(?:none|0)\b)/,
  /box-shadow\s*:/,
  /border(?:-color)?\s*:\s*(?!\s*(?:none|0)\b)/,
  /text-decoration\s*:\s*(?!\s*none\b)/,
]

for (const file of readdirSync(clientDir).filter(name => name.endsWith('.module.css'))) {
  const css = readFileSync(join(clientDir, file), 'utf8')
  for (const rule of collectRules(css)) {
    if (!/:focus-visible/.test(rule.selector)) continue
    if (!/outline\s*:\s*(?:none|0)\b/.test(rule.body)) continue
    if (!RING_GRADE.some(pattern => pattern.test(rule.body))) {
      note('error', `${file} ${rule.selector}`, 'focus-visible suppresses the outline with only hover feedback; add a ring (outline, box-shadow, border-color, or text-decoration)')
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Hardcoded colors: the Team Client uses --dsw-alias-* tokens; hardcoded
//    hex/rgb values are allowed only in the documented exceptions (static
//    white on colored fills, avatar hue).
// ---------------------------------------------------------------------------

const colorExceptions = new Set([
  'composer.module.css', // .sendButton static #fff on info fill (matches shipped)
  'conversation.module.css', // message clamp mask gradients + run divider shadow
  'sidebar.module.css', // avatar text #fff on the hue fill
])

for (const file of readdirSync(clientDir).filter(name => name.endsWith('.module.css'))) {
  if (colorExceptions.has(file)) continue
  const css = readFileSync(join(clientDir, file), 'utf8')
  for (const match of css.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)) {
    note('warn', `${file}`, `hardcoded color '${match[0]}' (only --dsw-alias-* tokens or documented exceptions)`)
  }
}

// ---------------------------------------------------------------------------
// 4. Control rhythm: 12px between sibling controls inside a composer/sidebar
//    toolbar group (the shipped figma 75:8208 spacing).
// ---------------------------------------------------------------------------

for (const file of ['composer.module.css', 'sidebar.module.css']) {
  const css = readFileSync(join(clientDir, file), 'utf8')
  for (const rule of collectRules(css)) {
    if (!/\.(toolbar|trailing|tools|modes|row)\b/.test(rule.selector)) continue
    const gap = rule.body.match(/gap\s*:\s*(\d+)px/)
    if (gap && Number(gap[1]) !== LANGUAGE.controlGap) {
      note('warn', `${file} ${rule.selector}`, `control gap ${gap[1]}px (language: ${LANGUAGE.controlGap}px)`)
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Icon semantics: the composer attach control must use the paperclip, not
//    the "+" (which in the base composer opens the command menu).
// ---------------------------------------------------------------------------

const composer = readFileSync(join(clientDir, 'TeamComposer.tsx'), 'utf8')
const attachBlock = composer.match(/className=\{css\.attachButton\}[\s\S]{0,400}/)?.[0] ?? ''
if (attachBlock.includes('IconPlusOutline16')) {
  note('error', 'TeamComposer.tsx', 'attach button still uses IconPlusOutline16; the "+" is the command-menu glyph in DSH')
}
if (!attachBlock.includes('IconPaperclipOutline16')) {
  note('error', 'TeamComposer.tsx', 'attach button does not use IconPaperclipOutline16')
}
if (!attachBlock.includes('Tooltip')) {
  note('warn', 'TeamComposer.tsx', 'attach button is not wrapped in a Tooltip (Team convention elsewhere)')
}

// ---------------------------------------------------------------------------
// 6. Shipped reference drift: whether the harness checkout still defines the
//    language primitives the Team parity relies on (a DSH upgrade may remove
//    or rename them — this is the upgrade tripwire).
// ---------------------------------------------------------------------------

const shippedInputBar = join(shippedDir, 'ui-conversation/src/client/skeleton/InputBar.tsx')
const shippedSidebarCss = join(shippedDir, 'ui-sidebar/src/client/SidebarRoot.module.css')
for (const [label, file, needles] of [
  ['shipped composer icons', shippedInputBar, ['IconPaperclipOutline16', 'IconPlusOutline16']],
  ['shipped sidebar focus ring', shippedSidebarCss, ['panelRow:focus-visible', 'outline: 2px solid var(--dsw-alias-label-primary)']],
  ['shipped mode-chip label cut', join(shippedDir, 'ui-conversation/src/client/skeleton/PermissionSelect.module.css'), ['@container (max-width: 460px)']],
]) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    note('error', label, `shipped reference file missing: ${file} — the harness checkout moved; re-verify the language baseline`)
    continue
  }
  for (const needle of needles) {
    if (!text.includes(needle)) {
      note('warn', label, `shipped reference no longer contains '${needle}' — a DSH upgrade may have changed the language; re-verify docs`)
    }
  }
}

// ---------------------------------------------------------------------------
// 7. Shipped primitive existence: every named import the Team Client takes
//    from @deepseek-ai/dsh-client-ui-primitives must still be exported by the
//    harness checkout. This is the upgrade tripwire for primitive removals —
//    MessageText disappeared in 0.1.5 while the docs still cited it.
// ---------------------------------------------------------------------------

function collectExportedNames(file, seen = new Set()) {
  const names = new Set()
  if (seen.has(file)) return names
  seen.add(file)
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return names
  }
  for (const match of text.matchAll(/export\s+(?:type\s+)?\{([^}]+)\}/g)) {
    for (const entry of match[1].split(',')) {
      const name = entry.trim().split(/\s+as\s+/).pop()?.trim()
      if (name) names.add(name)
    }
  }
  for (const match of text.matchAll(/export\s+(?:const|function|class|type|interface|enum)\s+(\w+)/g)) {
    names.add(match[1])
  }
  for (const match of text.matchAll(/export\s+\*\s+from\s+'([^']+)'/g)) {
    for (const name of collectExportedNames(resolve(dirname(file), match[1]), seen)) names.add(name)
  }
  return names
}

const primitivesBarrel = join(shippedDir, 'ui-primitives/src/index.ts')
const shippedPrimitives = collectExportedNames(primitivesBarrel)
if (shippedPrimitives.size === 0) {
  note('error', 'shipped primitives', `cannot read exported names from ${primitivesBarrel} — re-verify the parity baseline`)
} else {
  const seen = new Set()
  for (const file of readdirSync(clientDir).filter(name => name.endsWith('.tsx'))) {
    const src = readFileSync(join(clientDir, file), 'utf8')
    for (const match of src.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+'@deepseek-ai\/dsh-client-ui-primitives'/g)) {
      for (const entry of match[1].split(',')) {
        const name = entry.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]?.trim()
        if (!name || name === 'default' || seen.has(`${file}:${name}`)) continue
        seen.add(`${file}:${name}`)
        if (!shippedPrimitives.has(name)) {
          note('error', file, `imports '${name}' from dsh-client-ui-primitives, which the harness checkout no longer exports — a DSH upgrade removed or renamed it`)
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 8. Geometry language: the canonical controls keep the shipped dimensions —
//    icon-only controls 28×28, the primary round action 34×34 with its -2px
//    seat compensation, list rows 8px radius, chips 6px radius. A refactor or
//    a DSH upgrade must not silently move them.
// ---------------------------------------------------------------------------

const GEOMETRY = [
  ['composer.module.css', '.attachButton', [['height', '28px'], ['width', '28px'], ['border-radius', '999px']], 'icon-only control is 28×28, radius 999px'],
  ['composer.module.css', '.asTaskPill', [['height', '28px'], ['border-radius', '24px']], 'mode pill keeps the shipped chip geometry'],
  ['composer.module.css', '.sendButton', [['height', '34px'], ['width', '34px'], ['border-radius', '999px'], ['transform', 'translateY(-2px)']], 'primary round action is 34×34 with the -2px seat compensation'],
  ['sidebar.module.css', '.channelRow', [['border-radius', '8px']], 'list row radius is 8px'],
  ['sidebar.module.css', '.agentRow', [['border-radius', '8px']], 'list row radius is 8px'],
  ['sidebar.module.css', '.workspaceRow', [['border-radius', '8px']], 'list row radius is 8px'],
  ['sidebar.module.css', '.inboxCard', [['border-radius', '8px'], ['height', '34px']], 'the Inbox entry is a sidebar row: 8px radius, 34px height'],
  ['sidebar.module.css', '.inboxBadge', [['height', '18px'], ['border-radius', '999px'], ['box-sizing', 'border-box']], 'the count badge is an 18px capsule; border-box keeps one digit a circle instead of a padded oval'],
  ['inbox.module.css', '.row', [['border-radius', '8px']], 'the mention queue row shares the shipped 8px list-row radius'],
  ['inbox.module.css', '.rowTask', [['border-radius', '6px']], 'the Task marker on a queue row is a 6px chip'],
  ['composer.module.css', '.fileChip', [['border-radius', '6px']], 'chip radius is 6px'],
  ['conversation.module.css', '.attachmentChip', [['border-radius', '6px']], 'chip radius is 6px'],
  ['conversation.module.css', '.mention', [['border-radius', '6px']], 'inline mention chip radius is 6px'],
]

function findRuleBody(file, selector) {
  const css = readFileSync(join(clientDir, file), 'utf8')
  for (const rule of collectRules(css)) {
    // A rule preceded by a comment keeps that comment inside the captured
    // selector text; compare only the selector after the last comment.
    const bare = rule.selector.replace(/^[\s\S]*\*\//, '').trim()
    if (bare === selector) return rule.body
  }
  return undefined
}

for (const [file, selector, expected, what] of GEOMETRY) {
  const body = findRuleBody(file, selector)
  if (body === undefined) {
    note('error', `${file} ${selector}`, `canonical control is gone (${what})`)
    continue
  }
  for (const [property, value] of expected) {
    const declared = body.match(new RegExp(`${property}\\s*:\\s*([^;]+)`))?.[1]?.trim()
    if (declared === undefined) {
      note('error', `${file} ${selector}`, `no ${property} declared (${what})`)
    } else if (declared !== value) {
      note('error', `${file} ${selector}`, `${property} is '${declared}', expected '${value}' (${what})`)
    }
  }
}

// ---------------------------------------------------------------------------
// 9. Token existence: every --dsw-* token the Team Client references must be
//    defined by the shipped client source. A renamed/removed token falls back
//    silently, so the audit fails loudly instead — typos included.
// ---------------------------------------------------------------------------

function walkFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(path, out)
    else if (/\.(css|ts|tsx)$/.test(entry.name)) out.push(path)
  }
  return out
}

function collectShippedTokens() {
  const tokens = new Set()
  for (const file of walkFiles(join(shippedDir, 'ui-theme/src'))) {
    for (const match of readFileSync(file, 'utf8').matchAll(/--dsw-[\w-]+:/g)) {
      tokens.add(match[0].slice(0, -1))
    }
  }
  return tokens
}

const shippedTokens = collectShippedTokens()
if (shippedTokens.size === 0) {
  note('error', 'shipped theme', 'cannot read --dsw-* token definitions from the harness checkout — re-verify the parity baseline')
} else {
  const teamRefs = new Map()
  for (const file of readdirSync(clientDir).filter(name => /\.(css|tsx|ts)$/.test(name))) {
    const text = readFileSync(join(clientDir, file), 'utf8')
    for (const match of text.matchAll(/var\(--dsw-[\w-]+/g)) {
      const token = match[0].slice(4)
      if (!teamRefs.has(token)) teamRefs.set(token, new Set())
      teamRefs.get(token).add(file)
    }
  }
  for (const [token, files] of teamRefs) {
    if (!shippedTokens.has(token)) {
      note('error', [...files].sort().join(', '), `references '${token}' which the shipped theme does not define — a typo, or a DSH upgrade renamed it`)
    }
  }
}

// ---------------------------------------------------------------------------
// 10. Mode control language: as-task is a mode (it changes what Send means),
//     not an action. A mode keeps a visible word label and may only drop that
//     word behind an explicit narrow-container branch — the shipped permission
//     chip's own cut. Reducing a mode to a bare glyph loses its state to a
//     picture nobody agreed on, and a hover tooltip is not a label on touch.
// ---------------------------------------------------------------------------

const MODE_LABEL_CUT = 460
const composerCss = readFileSync(join(clientDir, 'composer.module.css'), 'utf8')
const asTaskPill = composer.match(/css\.asTaskPill[\s\S]{0,600}?<\/button>/)?.[0] ?? ''
if (asTaskPill === '') {
  note('error', 'TeamComposer.tsx', 'the as-task mode control is not rendered as css.asTaskPill — a mode is not an icon action')
} else {
  if (!/aria-pressed=\{asTask === true\}/.test(asTaskPill)) {
    note('error', 'TeamComposer.tsx', 'the as-task mode pill declares no aria-pressed state')
  }
  if (!/css\.asTaskLabel/.test(asTaskPill) || !/t\('asTask'\)/.test(asTaskPill)) {
    note('error', 'TeamComposer.tsx', "the as-task mode pill lost its visible word label (css.asTaskLabel + t('asTask'))")
  }
}

const labelRule = collectRules(composerCss).find(rule => rule.selector.replace(/^[\s\S]*\*\//, '').trim() === '.asTaskLabel')
if (labelRule === undefined) {
  note('error', 'composer.module.css .asTaskLabel', 'the mode label class is gone; a mode keeps a visible word')
} else if (/display\s*:\s*none|visibility\s*:\s*hidden/.test(labelRule.body)) {
  note('error', 'composer.module.css .asTaskLabel', 'the mode label is hidden unconditionally; hide it only inside the narrow-container branch')
}

const labelCut = composerCss.match(/@container\s*\(max-width:\s*(\d+)px\)\s*\{[\s\S]*?\.asTaskPill\s+\.asTaskLabel\s*\{[\s\S]*?display\s*:\s*none/)
if (labelCut === null) {
  note('error', 'composer.module.css', 'the as-task pill has no narrow-container label cut; the word may only be dropped behind an explicit @container branch')
} else if (Number(labelCut[1]) !== MODE_LABEL_CUT) {
  note('warn', 'composer.module.css', `as-task label cut at ${labelCut[1]}px (shipped cut: ${MODE_LABEL_CUT}px)`)
}

// ---------------------------------------------------------------------------
// 11. Corner-shape pairing: the shipped platform curves every rounded surface
//     along superellipse(1.5) (ui-theme/src/styles/corner-shape.css), which
//     deforms a circle into a squircle and squares off capsule ends. Every
//     effectively uncapped radius — 50%, 100%, 999px, a pill radius — must
//     therefore pair `corner-shape: round` in the same block. Shipped keeps
//     100% coverage of this pairing; a new full-round control that forgets it is
//     the drift this rule catches. The scan is textual: it reads the three
//     uncapped radius forms, but a pill radius that only exceeds its box at one
//     rendered size (say `border-radius: 12px` on a 24px row) is invisible here
//     and belongs in GEOMETRY instead.
// ---------------------------------------------------------------------------

const FULL_ROUND = /border-radius:\s*(?:50%|100%|999px)\s*;/
for (const file of readdirSync(clientDir).filter(name => name.endsWith('.module.css'))) {
  const css = readFileSync(join(clientDir, file), 'utf8')
  for (const rule of collectRules(css)) {
    if (!FULL_ROUND.test(rule.body)) continue
    if (!/corner-shape:\s*round/.test(rule.body)) {
      const bare = rule.selector.replace(/^[\s\S]*\*\//, '').replace(/\s+/g, ' ').trim().slice(0, 60)
      note('error', `${file} ${bare}`, 'full-round radius without `corner-shape: round`; the platform superellipse squares capsule ends off')
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const bySeverity = { error: [], warn: [], info: [] }
for (const finding of findings) bySeverity[finding.severity].push(finding)
const print = (list) => list.forEach(f => console.log(`  [${f.severity}] ${f.where}: ${f.what}`))

console.log('UI parity audit — Team Client vs DSH 0.1.5 design language')
console.log(`harness checkout: ${harnessDir}`)
console.log('')
console.log(`errors (${bySeverity.error.length}):`)
print(bySeverity.error)
console.log('')
console.log(`warnings (${bySeverity.warn.length}):`)
print(bySeverity.warn)
console.log('')
console.log(`info (${bySeverity.info.length}):`)
print(bySeverity.info)
console.log('')
if (bySeverity.error.length === 0) console.log('No mechanical language violations. Design judgment still lives in docs/frontend-design.md.')
process.exit(bySeverity.error.length === 0 ? 0 : 1)
