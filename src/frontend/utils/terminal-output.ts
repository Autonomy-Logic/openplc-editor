/**
 * Interpret the terminal control sequences that show up in captured
 * subprocess output (arduino-cli, strucpp, the toolchain) so the console can
 * render them the way a terminal would.
 *
 * Two sequences actually matter in build output:
 *
 * - **Carriage return.** Progress bars redraw by emitting `\r` and rewriting
 *   the line in place. Without this, every redraw becomes its own timestamped
 *   console entry and a single download turns into hundreds of stacked lines.
 * - **SGR colour** (`ESC[...m`). arduino-cli colours its compile summary
 *   table. Without this the raw bytes are printed literally as `ESC[92m`,
 *   which is what the old editor worked around by forcing `--no-color`.
 *
 * This is deliberately NOT a terminal emulator. Cursor addressing, scroll
 * regions and erase-in-line are not interpreted — build output does not use
 * them. Any other escape sequence is stripped rather than acted on, so it can
 * never leak into the rendered text.
 */

import type { LogSegment } from '../../middleware/shared/ports/types'

/** ESC (0x1B). Written as an escape so an editor cannot silently eat it. */
const ESC = '\u001B'

/**
 * CSI sequences: `ESC [ <params> <final byte>`.
 *
 * Group 1 is the parameter list, group 2 the final byte (`m` for SGR).
 * Shared by {@link parseAnsi} and {@link stripAnsi} so both agree exactly on
 * what counts as an escape sequence. Consumers use `String.matchAll` /
 * `String.replace`, both of which operate on an internal clone, so the `g`
 * flag carries no `lastIndex` state between calls.
 */
// eslint-disable-next-line no-control-regex -- matching the ESC control byte is the entire point
const CSI_PATTERN = /\u001B\[([0-9;?]*)([@-~])/g

/**
 * SGR foreground colours, standard (30-37) and bright (90-97).
 *
 * Tailwind pairs rather than raw hex: the console renders on both light and
 * dark backgrounds, and a literal terminal palette is unreadable on one of
 * them. Shades are chosen for contrast against the console background, not
 * for fidelity to any particular terminal theme.
 */
const SGR_FOREGROUND: Record<number, string> = {
  30: 'text-neutral-700 dark:text-neutral-300',
  31: 'text-red-600 dark:text-red-400',
  32: 'text-green-600 dark:text-green-400',
  33: 'text-yellow-600 dark:text-yellow-400',
  34: 'text-blue-600 dark:text-blue-400',
  35: 'text-fuchsia-600 dark:text-fuchsia-400',
  36: 'text-cyan-600 dark:text-cyan-400',
  37: 'text-neutral-600 dark:text-neutral-200',
  90: 'text-neutral-500 dark:text-neutral-400',
  91: 'text-red-500 dark:text-red-300',
  92: 'text-green-600 dark:text-green-400',
  93: 'text-yellow-600 dark:text-yellow-300',
  94: 'text-blue-500 dark:text-blue-300',
  95: 'text-fuchsia-500 dark:text-fuchsia-300',
  96: 'text-cyan-500 dark:text-cyan-300',
  97: 'text-neutral-800 dark:text-neutral-100',
}

/** True when `text` carries any escape sequence worth parsing. */
export function hasAnsi(text: string): boolean {
  return text.includes(ESC)
}

/**
 * Remove every escape sequence, leaving the human-readable text.
 *
 * This is what gets stored as the log message, so search, filtering and
 * copy-to-clipboard all keep working on clean text without knowing that
 * colour exists at all.
 */
export function stripAnsi(text: string): string {
  return hasAnsi(text) ? text.replace(CSI_PATTERN, '') : text
}

/**
 * Split `text` into styled runs.
 *
 * Returns a single unstyled segment when there is no colour, so callers can
 * treat the result uniformly. Only SGR sequences affect styling; other CSI
 * sequences are consumed and dropped.
 */
export function parseAnsi(text: string): LogSegment[] {
  if (!hasAnsi(text)) return text ? [{ text }] : []

  const segments: LogSegment[] = []
  let foreground: string | undefined
  let bold = false
  let cursor = 0

  const currentClass = () => [foreground, bold ? 'font-bold' : undefined].filter(Boolean).join(' ') || undefined

  const push = (value: string) => {
    if (!value) return
    const className = currentClass()
    // Merge into the previous run when the style is unchanged: a reset
    // immediately followed by the same colour is common, and would otherwise
    // emit a string of adjacent identical spans.
    const previous = segments[segments.length - 1]
    if (previous && previous.className === className) {
      previous.text += value
      return
    }
    segments.push(className ? { text: value, className } : { text: value })
  }

  for (const match of text.matchAll(CSI_PATTERN)) {
    push(text.slice(cursor, match.index))
    cursor = match.index + match[0].length

    // Only SGR (`m`) changes styling. Every other CSI is dropped above.
    if (match[2] !== 'm') continue

    // An empty parameter list means SGR 0 (reset), per ECMA-48.
    const params = match[1] === '' ? [0] : match[1].split(';').map(Number)
    for (const code of params) {
      if (code === 0) {
        foreground = undefined
        bold = false
      } else if (code === 1) {
        bold = true
      } else if (code === 22) {
        bold = false
      } else if (code === 39) {
        foreground = undefined
      } else if (SGR_FOREGROUND[code]) {
        foreground = SGR_FOREGROUND[code]
      }
      // Unknown codes (backgrounds, 256-colour selectors, ...) are ignored
      // rather than rendered — the text they wrap is still shown, and the
      // sequence itself is already stripped.
    }
  }

  push(text.slice(cursor))
  return segments
}

/**
 * An ASCII progress bar: a bracketed run of bar glyphs, as arduino-cli draws
 * when it thinks it knows the terminal width. The 8-character floor keeps this
 * away from ordinary bracketed text.
 */
const PROGRESS_BAR_PATTERN = /\s*\[[=>#\s-]{8,}\]\s*/g

/**
 * Drop the ASCII bar from a progress line, leaving the numbers.
 *
 * arduino-cli sizes the bar to a width it guesses from its own environment,
 * which is never the width of the console panel — the panel is resizable, and
 * the side bar moves. A 150-glyph bar in a narrower panel wraps into several
 * visual lines, which is exactly what the carriage-return handling exists to
 * prevent. There is no width we could pass to fix this at the source.
 *
 * Removing it is not a loss: the bar is a redundant rendering of the
 * percentage that follows it, and this is the same compact form arduino-cli
 * itself emits when it cannot determine a width
 * (`tool 2.60 MiB / 34.99 MiB   7.44% 00m04s`).
 *
 * Only ever applied to carriage-return redraws, so ordinary output containing
 * bracketed text is untouched.
 */
export function stripProgressBar(line: string): string {
  return line.includes('[') ? line.replace(PROGRESS_BAR_PATTERN, '  ') : line
}

/**
 * Collapse a carriage-return redraw to what a terminal would leave on screen.
 *
 * `\r` returns the cursor to column 0, so only the text written after the
 * last one survives. A trailing `\r` moves the cursor but writes nothing, so
 * the preceding text stays visible.
 */
export function collapseCarriageReturns(line: string): string {
  if (!line.includes('\r')) return line

  const frames = line.split('\r')
  while (frames.length > 1 && frames[frames.length - 1] === '') frames.pop()
  return frames[frames.length - 1]
}
