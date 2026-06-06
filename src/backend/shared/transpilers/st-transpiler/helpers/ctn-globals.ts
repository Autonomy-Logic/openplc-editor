/**
 * Configuration-level globals injected by host plugins (Beremiz CTN
 * mechanism).  Mirrors `Controler.GetConfigurationExtraVariables`
 * (PLCControler.py:1248-1285): a provider callback returns either
 * pre-built `varlist` entries or `(name, type, initial)` tuples that
 * the configuration emitter folds into the resource's `VAR_GLOBAL`
 * sections.
 *
 * In a standalone xml2st build the provider is stubbed to `[]`, so
 * observable behaviour against the python oracle is unchanged — the
 * shape is exported so editor/web hosts wiring plugins can plug in.
 */

/**
 * IEC 61131-3 elementary base types — mirrors `Controler.GetBaseTypes()`
 * (derived from `TypeHierarchy_list` in `plcopen/definitions.py:84`).
 * Used to decide whether a synthesised global's type is elementary
 * (emit verbatim) or derived (emit as a type reference).
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

export interface CtnGlobalVarTuple {
  name: string
  /** Elementary type name (`'BOOL'`, `'INT'`, …) or a derived-type name. */
  type: string
  /** ST source for the initial value (`''` omits `:= …`). */
  initial?: string
}

export type CtnGlobalEntry = { kind: 'variable'; variable: CtnGlobalVarTuple }

export type ConfigurationExtraVariablesProvider = () => CtnGlobalEntry[]
