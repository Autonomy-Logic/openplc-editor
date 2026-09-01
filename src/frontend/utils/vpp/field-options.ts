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

/**
 * A `disabled` option is shown and not selectable. It exists so a picker can
 * say WHY a choice is unavailable instead of quietly omitting it — the Modbus
 * RTU port picker lists the board's default UART greyed out, because that line
 * carries the editor connection.
 */
export type FieldOption = string | { value: string; label: string; disabled?: boolean }

export interface FieldOptionSource {
  options?: FieldOption[]
  optionsRef?: string
}

/** Walk a dotted path (`a.b.c`) into a context object; undefined on any miss. */
function lookupPath(path: string, context: Record<string, unknown>): unknown {
  let cursor: unknown = context
  for (const part of path.split('.')) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') return undefined
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
