/**
 * Resolve the option list for a VPP screen `select` field.
 *
 * A field may declare static `options` and/or a dynamic `optionsRef` — a dotted
 * path (e.g. `"board.serialPorts"`) resolved against per-board context so the
 * same shared screen adapts to each board (the Modbus RTU serial-port picker
 * lists only the UARTs the board actually exposes). When `optionsRef` resolves
 * to a non-empty array it wins; otherwise the static `options` are the fallback,
 * so a board that doesn't declare the referenced data still renders sensibly.
 *
 * Pure — no store, no I/O.
 */

export type FieldOption = string | { value: string; label: string }

export interface FieldOptionSource {
  options?: FieldOption[]
  optionsRef?: string
}

/** Segments that would reach the prototype chain instead of real data. */
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])

/** Depth a single `optionsRef` may traverse. */
const MAX_OPTIONS_REF_DEPTH = 8

/**
 * Walk a dotted path (`a.b.c`) into a context object; undefined on any miss.
 *
 * `optionsRef` comes from a vendor package, so it is untrusted: a path through
 * `constructor` or `__proto__` would walk off the data and into the prototype
 * chain, and whatever it found there would be offered to the user as options
 * and then written into the generated plugin config. Own properties only, and
 * a bounded number of them.
 */
function lookupPath(path: string, context: Record<string, unknown>): unknown {
  const parts = path.split('.')
  if (parts.length > MAX_OPTIONS_REF_DEPTH) return undefined

  let cursor: unknown = context
  for (const part of parts) {
    if (FORBIDDEN_PATH_SEGMENTS.has(part)) return undefined
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') return undefined
    if (!Object.prototype.hasOwnProperty.call(cursor, part)) return undefined
    cursor = (cursor as Record<string, unknown>)[part]
  }
  return cursor
}

function isFieldOption(value: unknown): value is FieldOption {
  return typeof value === 'string' || (typeof value === 'object' && value !== null && 'value' in value)
}

export function resolveFieldOptions(
  field: FieldOptionSource,
  context: { board?: Record<string, unknown> | undefined },
): FieldOption[] {
  if (field.optionsRef) {
    const resolved = lookupPath(field.optionsRef, context as Record<string, unknown>)
    if (Array.isArray(resolved)) {
      const opts = resolved.filter(isFieldOption)
      if (opts.length > 0) return opts
    }
    // optionsRef present but unresolved / empty → fall back to static options.
  }
  return field.options ?? []
}
