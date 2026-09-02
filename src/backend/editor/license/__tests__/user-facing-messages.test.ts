/**
 * Every licensing message the user can read is a COMPLETE SENTENCE.
 *
 * Why this is a test and not a style note. These strings are written at one
 * layer and rendered at another: `outcome.error` is produced in license-flow,
 * main and the activation client, and rendered as a paragraph of its own by the
 * licence modal and by the badge panel. They were originally written as
 * fragments, to be spliced mid-sentence — so the modal produced
 *
 *   "...whether this device holds a licence.
 *    this board did not report an identity..."
 *
 * a lower-case paragraph opening, which reads as a typo rather than as a
 * detail. Fixing them one at a time is what let the two conventions coexist in
 * the same file (`main.ts` had one capitalised message and one not). So the
 * convention is pinned here instead, over the source, because the failure mode
 * is a NEW message written the old way — which no behavioural test would catch.
 *
 * Scanning source text is unusual and deliberate: the alternative is asserting
 * the format inside every behavioural test, which covers only the paths those
 * tests happen to exercise and silently misses the next message added.
 */

import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Files that produce `outcome.error` / `verdict.reason` text the user reads.
 *
 * `main.ts` is SCOPED: it is the whole IPC surface, so most of its `error:`
 * strings belong to downloads, file watching and the debugger and are not
 * licensing text at all. Only the lines that BUILD a licensing outcome count.
 * The other three files exist for licensing, so every message in them does.
 */
const SOURCES: { rel: string; scope?: RegExp }[] = [
  { rel: 'src/backend/editor/license/license-flow.ts' },
  { rel: 'src/backend/editor/license/license-activation-client.ts' },
  { rel: 'src/main/modules/ipc/main.ts', scope: /checkFailed(Terminal)?\(|state: 'check-failed'/ },
  { rel: 'src/frontend/hooks/use-device-license.ts' },
]

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..')

/**
 * Message literals assigned to `error:` or `reason:`, single- and
 * double-quoted plus backticks, including the multi-line concatenated form
 * (`'first part ' +\n  'second part'`), which is how the longer messages are
 * written.
 */
function messageLiterals(source: string, scope?: RegExp): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = []
  const lines = source.split('\n')

  for (let i = 0; i < lines.length; i++) {
    // `error:` / `reason:` assignments, plus `new Error(...)` in the activation
    // client, whose `.message` is surfaced as `outcome.error` one layer up.
    const kv = /\b(?:error|reason):\s*(.*)$|\bnew Error\((.*)$/.exec(lines[i])
    if (!kv) continue
    // When a file is scoped, the message must sit inside a licensing
    // construction: on this line, or in the few lines above that opened it.
    if (scope && !lines.slice(Math.max(0, i - 4), i + 1).some((l) => scope.test(l))) continue

    // Collect this line plus any continuation lines, so a concatenated message
    // is judged as the one sentence it renders as.
    // The value may start on the NEXT line: the two longest messages are
    // written as `error:` alone, with the concatenated string below it. Reading
    // only this line silently skipped them, which left the guard passing over
    // the very messages that motivated it.
    let blob = (kv[1] ?? kv[2] ?? '').trim()
    let j = i
    while (blob === '' && j + 1 < lines.length) {
      j += 1
      blob = lines[j].trim()
    }
    // Then absorb continuation lines, so a concatenated message is judged as
    // the one sentence it renders as.
    while (/\+\s*$/.test(blob) && j + 1 < lines.length) {
      j += 1
      blob += ' ' + lines[j].trim()
    }
    // A value that is a bare identifier or a nested read (`error: read.error`)
    // carries no text of its own.
    if (!/^['"`]/.test(blob)) continue

    const pieces = blob.match(/(['"`])(?:\\.|(?!\1)[\s\S])*\1/g)
    if (!pieces) continue
    const text = pieces.map((p) => p.slice(1, -1)).join('')
    if (text.trim().length === 0) continue
    out.push({ text, line: i + 1 })
  }
  return out
}

const collected = SOURCES.flatMap(({ rel, scope }) =>
  messageLiterals(readFileSync(join(REPO_ROOT, rel), 'utf-8'), scope).map((m) => ({ ...m, rel })),
)

describe('user-facing licensing messages', () => {
  it('finds messages to check in every source that produces them', () => {
    // Guards the guard: a refactor that moves these strings elsewhere must not
    // leave this suite passing over an empty set.
    expect(collected.length).toBeGreaterThanOrEqual(16)
    for (const { rel } of SOURCES) {
      expect(collected.some((m) => m.rel === rel)).toBe(true)
    }
  })

  /** A leading `${...}` is another message being composed in — already checked. */
  const own = collected.filter((m) => !m.text.trimStart().startsWith('${'))

  it('starts every message with a capital letter', () => {
    const offenders = own.filter((m) => /^[a-z]/.test(m.text.trimStart()))
    expect(offenders.map((m) => `${m.rel}:${m.line} — ${m.text.slice(0, 60)}`)).toEqual([])
  })

  it('ends every message with sentence punctuation', () => {
    const offenders = collected.filter((m) => !/[.?!]\s*$/.test(m.text.replace(/\$\{[^}]*\}\s*$/, '').trimEnd()))
    expect(offenders.map((m) => `${m.rel}:${m.line} — ${m.text.slice(-60)}`)).toEqual([])
  })

  it('uses no em or en dash', () => {
    // A dash reads as machine-written in a product string, and a hyphen or a
    // second sentence always says the same thing.
    const offenders = collected.filter((m) => /[—–]/.test(m.text))
    expect(offenders.map((m) => `${m.rel}:${m.line} — ${m.text.slice(0, 60)}`)).toEqual([])
  })

  it('leaks no internal vocabulary', () => {
    // Words that mean something to this codebase and nothing to the person
    // holding the board. Each of these reached a modal at some point.
    const jargon = /\b(0x[0-9a-fA-F]{2}|crc32|OPLC magic|license-core|blob|backend|JSON|payload|ms\))\b/
    const offenders = collected.filter((m) => jargon.test(m.text))
    expect(offenders.map((m) => `${m.rel}:${m.line} — ${m.text.slice(0, 70)}`)).toEqual([])
  })

  it('spells licence the way the UI does', () => {
    // The dialogs are British ("Licence Check Failed"), and these strings land
    // inside the same paragraph — "holds a licence. the stored license..." was
    // the rendered result of mixing them.
    const offenders = collected.filter((m) => /\blicens(e|es)\b/.test(m.text))
    expect(offenders.map((m) => `${m.rel}:${m.line} — ${m.text.slice(0, 70)}`)).toEqual([])
  })
})
