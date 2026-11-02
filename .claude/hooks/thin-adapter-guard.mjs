#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook: enforces "Thin adapters (hard rule)" from CLAUDE.md.
 *
 * The first write an agent makes to a platform file in a session is blocked (exit 2)
 * and the rule is shown to it. The same write then goes through, so an agent adding
 * a genuine mechanism repeats it after saying which one; anything else moves to the
 * shared surface. Test files and the shared surface are never blocked.
 *
 * Input: the hook JSON on stdin (`session_id`, `tool_input.file_path`, `cwd`).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'

const PLATFORM_DIRS = ['src/middleware/adapters/', 'src/main/', 'src/backend/editor/', 'src/backend/web/']
const TEST_FILE = /(^|\/)__tests__\/|\.(test|spec)\.[cm]?[jt]sx?$/

const RULE = `Thin adapters (hard rule, CLAUDE.md): all logic lives in the shared surface.
Platform code (src/middleware/adapters/*, src/main/, src/backend/editor/, src/backend/web/) may only:
  - store and bring back data verbatim (files, HTTP, IPC, WebRTC);
  - run code elsewhere (threads, workers, processes);
  - reach the OS (dialogs, keyring, serial ports, menus, system browser);
  - handle transport (retry a transient failure, turn a transport failure into an Error).
Parsing, validation, interpreting response bodies, defaults, formats, state machines and building
domain objects go to the shared surface; the platform supplies mechanisms to a shared factory
(reference: ESI repository, ports/esi-repository-mechanisms.ts). A port method implemented here
must exist on the other platform too.`

function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf-8'))
  } catch {
    return null
  }
}

function platformPath(input) {
  const filePath = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path
  if (typeof filePath !== 'string' || filePath === '') return null
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()
  const rel = relative(root, isAbsolute(filePath) ? filePath : join(root, filePath))
    .split(sep)
    .join('/')
  if (rel.startsWith('../') || TEST_FILE.test(rel)) return null
  return PLATFORM_DIRS.some((dir) => rel.startsWith(dir)) ? rel : null
}

/** Records `rel` for this session; true when it was already recorded. */
function seenBefore(sessionId, rel) {
  const dir = join(tmpdir(), 'claude-thin-adapter-guard')
  const file = join(dir, `${String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_')}.json`)
  let seen = []
  try {
    if (existsSync(file)) seen = JSON.parse(readFileSync(file, 'utf-8'))
  } catch {
    seen = []
  }
  if (seen.includes(rel)) return true
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, JSON.stringify([...seen, rel]))
  return false
}

const input = readInput()
const rel = platformPath(input)
if (rel === null || seenBefore(input.session_id ?? 'unknown', rel)) process.exit(0)

process.stderr.write(
  `Blocked once: ${rel} is platform code.\n\n${RULE}\n\n` +
    'If this change is only a mechanism, state which one in your reply and repeat the same edit. ' +
    'Otherwise put the logic in the shared surface (src/middleware/shared, src/backend/shared, ' +
    'src/frontend) and have this file supply only the mechanism.\n',
)
process.exit(2)
