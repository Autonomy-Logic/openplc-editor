/**
 * IEC 61131-3 elementary base types — mirrors python's
 * `Controler.GetBaseTypes()` (derived from `TypeHierarchy_list` in
 * `plcopen/definitions.py:84`).  Used by the emit pipeline to
 * decide whether a type name resolves to an elementary `<TYPE/>`
 * element or a `<derived name="…"/>` wrapper.
 *
 * `WSTRING` is intentionally absent — matches python's `# TODO`
 * comment at `definitions.py:118`.
 */

export const PLC_BASE_TYPES: ReadonlySet<string> = new Set([
  'BOOL',
  'SINT',
  'INT',
  'DINT',
  'LINT',
  'USINT',
  'UINT',
  'UDINT',
  'ULINT',
  'REAL',
  'LREAL',
  'TIME',
  'DATE',
  'TOD',
  'DT',
  'STRING',
  'BYTE',
  'WORD',
  'DWORD',
  'LWORD',
])
