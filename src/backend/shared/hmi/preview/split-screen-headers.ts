/**
 * Gives each screen of a preview unit its own copy of the unit header, without the other screens' classes, so an edit
 * of one screen recompiles that screen and the glue only. A header whose screen classes cannot be found is left whole.
 */

/** The unit header STruC++ writes, which declares every screen. */
const UNIT_HEADER = 'hmi_unit.hpp'
const INCLUDE = `#include "${UNIT_HEADER}"`
const CLASS_END = '\n};\n'

/** Header of one screen, by its class name. */
export const screenHeaderName = (screenClass: string): string => `hmi_screen_${screenClass}.hpp`

/** Where a screen's class starts and ends in the header, or null when it is not there exactly once. */
function classSpan(header: string, screenClass: string): { start: number; end: number } | null {
  const opening = new RegExp(`\\nclass ${screenClass} : public \\w+ \\{\\n`, 'g')
  const found = [...header.matchAll(opening)]
  if (found.length !== 1) return null
  const start = found[0].index
  const close = header.indexOf(CLASS_END, start)
  if (close < 0 || header.slice(start + 1, close).includes('\nclass ')) return null
  return { start, end: close + CLASS_END.length - 1 }
}

/**
 * The unit's files with one header per screen (`screenHeaderName`) included by that screen's files in place of the
 * unit header. `screens` maps each screen's name to its files.
 */
export function splitScreenHeaders(
  files: Readonly<Record<string, string>>,
  screens: Readonly<Record<string, readonly string[]>>,
): Record<string, string> {
  const header = files[UNIT_HEADER]
  if (header === undefined) return { ...files }
  const spans = new Map<string, { start: number; end: number }>()
  for (const name of Object.keys(screens)) {
    const span = classSpan(header, name.toUpperCase())
    if (!span) return { ...files }
    spans.set(name, span)
  }
  const ordered = [...spans.entries()].sort((a, b) => a[1].start - b[1].start)
  const out: Record<string, string> = { ...files }
  for (const [name, own] of spans) {
    let text = ''
    let at = 0
    for (const [, span] of ordered) {
      if (span === own) continue
      text += header.slice(at, span.start)
      at = span.end
    }
    text += header.slice(at)
    const screenHeader = screenHeaderName(name.toUpperCase())
    out[screenHeader] = text
    for (const file of screens[name]) {
      const source = out[file]
      if (source !== undefined) out[file] = source.split(INCLUDE).join(`#include "${screenHeader}"`)
    }
  }
  return out
}
