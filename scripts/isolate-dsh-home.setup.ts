import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Agent Team tests boot the real plugin, whose startup hook prunes
// `member:*` directories unknown to the test ledger. Without isolation that
// hook has seen the developer's real `~/.dsh/agent-team/members/` and wiped
// it — on 2026-08-23 three live Member memory directories were lost this way
// to a single unisolated spec file. Give every test file its own throwaway
// DSH home unconditionally: the harness session exports DSH_HOME itself, so
// testing whether it is unset is never enough. Specs that need a specific
// home set `process.env.DSH_HOME` themselves and keep save/restore semantics
// around it (member-lifecycle).
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-agent-team-test-home-'))
