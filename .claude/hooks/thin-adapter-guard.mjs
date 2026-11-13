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
import { dirname, join, relative, resolve, sep } from 'node:path'

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

/** Root of the editor or web checkout (worktrees included) that holds `filePath`; null outside one. */
function checkoutRoot(filePath) {
  let dir = dirname(filePath)
  for (;;) {
    if (existsSync(join(dir, '.git'))) return existsSync(join(dir, 'src/middleware/adapters')) ? dir : null
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function platformPath(input) {
  const filePath = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path
  if (typeof filePath !== 'string' || filePath === '') return null
  const absolute = resolve(input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd(), filePath)
  const root = checkoutRoot(absolute)
  if (root === null) return null
  const rel = relative(root, absolute).split(sep).join('/')
  if (TEST_FILE.test(rel) || !PLATFORM_DIRS.some((dir) => rel.startsWith(dir))) return null
  return absolute
}

/** Records `path` for this session; true when it was already recorded or cannot be recorded. */
function seenBefore(sessionId, path) {
  const dir = join(tmpdir(), `claude-thin-adapter-guard-${process.getuid?.() ?? 'user'}`)
  const file = join(dir, `${String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_')}.json`)
  let seen = []
  try {
    const stored = existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : []
    if (Array.isArray(stored)) seen = stored
  } catch {
    seen = []
  }
  if (seen.includes(path)) return true
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    writeFileSync(file, JSON.stringify([...seen, path]))
  } catch {
    return true
  }
  return false
}

const input = readInput()
const path = platformPath(input)
if (path === null || seenBefore(input.session_id ?? 'unknown', path)) process.exit(0)

process.stderr.write(
  `Blocked once: ${path} is platform code.\n\n${RULE}\n\n` +
    'If this change is only a mechanism, state which one in your reply and repeat the same edit. ' +
    'Otherwise put the logic in the shared surface (src/middleware/shared, src/backend/shared, ' +
    'src/frontend) and have this file supply only the mechanism.\n',
)
process.exit(2)
