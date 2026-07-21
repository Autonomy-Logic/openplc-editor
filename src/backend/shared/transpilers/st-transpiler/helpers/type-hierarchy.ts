/**
 * IEC 61131-3 type hierarchy.
 *
 * Mirrors ``plcopen/definitions.py:84-119`` (`TypeHierarchy_list`) and
 * ``plcopen/structures.py:51-59`` (`GetSubTypes`).
 *
 * The hierarchy is a tree rooted at `"ANY"` with each concrete IEC type
 * (`"INT"`, `"BOOL"`, `"REAL"`, …) attached under its ANY-prefixed
 * meta-parent.
 *
 * Note on WSTRING: Python's hierarchy comments-out `("WSTRING", "ANY_STRING")`
 * with a TODO. We preserve that — WSTRING is absent from the table.
 */

/**
 * Parent pointer table. `null` parent means root (`"ANY"`).
 * Insertion order matches `plcopen/definitions.py:TypeHierarchy_list`.
 */
export const TypeHierarchy: Readonly<Record<string, string | null>> = {
  ANY: null,
  ANY_DERIVED: 'ANY',
  ANY_ELEMENTARY: 'ANY',
  ANY_MAGNITUDE: 'ANY_ELEMENTARY',
  ANY_BIT: 'ANY_ELEMENTARY',
  ANY_NBIT: 'ANY_BIT',
  ANY_STRING: 'ANY_ELEMENTARY',
  ANY_DATE: 'ANY_ELEMENTARY',
  ANY_NUM: 'ANY_MAGNITUDE',
  ANY_REAL: 'ANY_NUM',
  ANY_INT: 'ANY_NUM',
  ANY_SINT: 'ANY_INT',
  ANY_UINT: 'ANY_INT',
  BOOL: 'ANY_BIT',
  SINT: 'ANY_SINT',
  INT: 'ANY_SINT',
  DINT: 'ANY_SINT',
  LINT: 'ANY_SINT',
  USINT: 'ANY_UINT',
  UINT: 'ANY_UINT',
  UDINT: 'ANY_UINT',
  ULINT: 'ANY_UINT',
  REAL: 'ANY_REAL',
  LREAL: 'ANY_REAL',
  TIME: 'ANY_MAGNITUDE',
  DATE: 'ANY_DATE',
  TOD: 'ANY_DATE',
  DT: 'ANY_DATE',
  STRING: 'ANY_STRING',
  BYTE: 'ANY_NBIT',
  WORD: 'ANY_NBIT',
  DWORD: 'ANY_NBIT',
  LWORD: 'ANY_NBIT',
  // Platform-width address type (strucpp/CODESYS parity); strucpp resolves the
  // concrete width per target.
  __XWORD: 'ANY_NBIT',
  // WSTRING intentionally absent — matches Python's `# TODO` comment.
}
