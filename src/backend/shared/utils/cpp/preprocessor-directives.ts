/**
 * The preprocessor skeleton of a C++ block: every directive the user wrote,
 * with all the code between removed.
 *
 * Two callers need the same thing for different reasons.
 *
 * `composeFirmwareBundle` emits it beside the sketch, where arduino-cli reads
 * it and learns which libraries the firmware needs — that unit is compiled on
 * the other side of the pre-compile seam, so without this arduino-cli never
 * sees what the block asked for and never puts the library's sources on the
 * link line.
 *
 * `generateCBlocksCode` emits it ahead of the variable-binding macros. Those
 * macros rename every Variables Table entry, and a header included after them
 * is rewritten too: a block with an output called `connected` turned
 * `BluetoothSerial.h`'s `bool connected(int timeout = 0)` into
 * `bool (*(vars->CONNECTED))(int timeout = 0)`. Hoisting the includes above the
 * macros is what keeps a library header reading as its author wrote it.
 *
 * Why the whole directive stream rather than the `#include` lines alone: an
 * include is only reached when its enclosing conditions hold. Lifting
 *
 *     #ifdef ARDUINO_ARCH_ESP32
 *     #include <WiFi.h>
 *     #endif
 *
 * as a bare `#include <WiFi.h>` breaks an AVR build that compiles today.
 * Copying the stream instead of interpreting it means the conditions are
 * evaluated by the compiler, for the board actually selected, rather than
 * guessed here — and it carries `#define`s along, so an include whose name is
 * formed by a macro still resolves.
 *
 * A conditional group whose body was all code becomes an empty `#if`/`#endif`
 * pair. That is deliberate: pruning it would mean deciding whether anything
 * inside still matters, which is the evaluation this exists to avoid.
 *
 * Dropped on the way:
 *
 * - **code** — anything not starting with `#`.
 * - **`#include "..."`** — names a file beside the user's source, which does
 *   not exist beside the sketch.
 * - **`#error` / `#warning`** — the block's own translation unit still carries
 *   them and raises them there. Repeated here they could also fire spuriously,
 *   on a condition that reads a macro only one side has.
 * - **`#pragma`** — no effect on a file with no code.
 */

/** Conditional and macro directives travel; everything else does not. */
const KEPT_DIRECTIVES = new Set([
  'if',
  'ifdef',
  'ifndef',
  'elif',
  'elifdef',
  'elifndef',
  'else',
  'endif',
  'define',
  'undef',
])

/**
 * Splice line continuations and strip comments, in that order — the order the
 * C++ standard itself uses, and the reason a block comment spanning a
 * `\`-ended line is handled correctly.
 */
export function stripCommentsAndSplice(source: string): string {
  const spliced = source.replace(/\\\r?\n/g, '')

  let out = ''
  let index = 0
  type Mode = 'code' | 'line' | 'block' | 'string' | 'char'
  let mode: Mode = 'code'

  while (index < spliced.length) {
    const char = spliced[index]
    const next = spliced[index + 1]

    if (mode === 'code') {
      if (char === '/' && next === '/') {
        mode = 'line'
        index += 2
      } else if (char === '/' && next === '*') {
        mode = 'block'
        index += 2
      } else {
        if (char === '"') mode = 'string'
        else if (char === "'") mode = 'char'
        out += char
        index += 1
      }
    } else if (mode === 'line') {
      if (char === '\n') {
        mode = 'code'
        out += char
      }
      index += 1
    } else if (mode === 'block') {
      // Newlines are kept so directives keep their own lines.
      if (char === '\n') out += char
      if (char === '*' && next === '/') {
        mode = 'code'
        index += 2
      } else {
        index += 1
      }
    } else {
      // Inside a string or char literal: copied verbatim, escapes included, so
      // a `//` or `/*` in a literal is not mistaken for a comment.
      if (char === '\\') {
        out += char + (next ?? '')
        index += 2
        continue
      }
      if ((mode === 'string' && char === '"') || (mode === 'char' && char === "'")) mode = 'code'
      out += char
      index += 1
    }
  }
  return out
}

/** One block's directive stream, and whether it asks for any library at all. */
export interface DirectiveStream {
  lines: string[]
  hasInclude: boolean
}

/** The directives a single block declares, in the order it declared them. */
export function directiveStream(source: string): DirectiveStream {
  const lines: string[] = []
  let hasInclude = false

  for (const line of stripCommentsAndSplice(source).split('\n')) {
    const directive = /^[ \t]*#[ \t]*([A-Za-z_]+)\b(.*)$/.exec(line)
    if (directive === null) continue

    const [, name, rest] = directive
    if (name === 'include') {
      const angle = /^[ \t]*<[^>]+>/.exec(rest)
      // A macro-formed include (`#include LIB`) travels too: the `#define` that
      // builds it came along, so the compiler resolves it.
      const quoted = /^[ \t]*"/.test(rest)
      if (angle !== null || (!quoted && rest.trim().length > 0)) {
        hasInclude = true
        lines.push(`#include${rest}`)
      }
      continue
    }
    if (KEPT_DIRECTIVES.has(name)) lines.push(`#${name}${rest}`)
  }

  return { lines, hasInclude }
}
