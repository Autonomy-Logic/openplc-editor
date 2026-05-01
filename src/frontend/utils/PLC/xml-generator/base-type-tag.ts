/**
 * Pick the PLCopen TC6 0201 XML element tag for a base type value.
 *
 * The schema is mixed-case on purpose: `<string>` / `<wstring>` are
 * lowercase, every other base type (`<BOOL>`, `<INT>`, `<REAL>`, ...)
 * is uppercase. xml2st (MatIEC's TC6 schema validator) rejects
 * `<STRING>` outright with the same "expected one of (BOOL, BYTE, ...)"
 * error that surfaces the symptom for users.
 *
 * The project data normalizes base-type values to uppercase
 * (frontend/utils/plc-constants/types.ts: `'STRING'`), but legacy
 * project files and some adapters keep them lowercase. Compare
 * case-insensitively so both shapes round-trip through the XML
 * emitter without falling through to the uppercase-everything
 * branch.
 */
export const baseTypeTag = (value: string): string => {
  const lower = value.trim().toLowerCase()
  if (lower === 'string' || lower === 'wstring') return lower
  return value.trim().toUpperCase()
}
