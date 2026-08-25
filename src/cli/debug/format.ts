/**
 * Human rendering for debug values, mirroring the STruC++ REPL.
 *
 * Deliberately only the HUMAN side. JSON output carries the canonical value
 * (a number for BYTE, a boolean for BOOL); this adds the conventions a person
 * reading a terminal expects and the REPL already established: bit-string types
 * in hex, booleans as TRUE/FALSE, a `[FORCED]` marker. Someone moving between
 * `strucpp`'s REPL and this one should not have to relearn the display.
 */

import type { VariableValue } from '../session/protocol'

/** Types the STruC++ REPL shows in hex, because they are bit patterns. */
const BIT_STRING_TYPES = new Set(['BYTE', 'WORD', 'DWORD', 'LWORD'])

export function formatValue(value: VariableValue): string {
  if (value.value === null) return '<unreadable>'
  if (typeof value.value === 'boolean') return value.value ? 'TRUE' : 'FALSE'
  if (typeof value.value === 'number' && BIT_STRING_TYPES.has(value.type.toUpperCase())) {
    return `16#${value.value.toString(16).toUpperCase()}`
  }
  return String(value.value)
}

/** `MAIN.counter : INT = 42 [FORCED]` — one variable, REPL style. */
export function formatVariableLine(value: VariableValue, namePad = 0): string {
  const name = namePad > 0 ? value.name.padEnd(namePad) : value.name
  const forced = value.forced ? ' [FORCED]' : ''
  return `${name} : ${value.type} = ${formatValue(value)}${forced}`
}

/** A block of variables, names column-aligned. */
export function formatVariableList(values: readonly VariableValue[]): string {
  if (values.length === 0) return '(no variables)'
  const width = Math.max(...values.map((value) => value.name.length))
  return values.map((value) => `  ${formatVariableLine(value, width)}`).join('\n')
}
