/**
 * IEC 61131-3 type hierarchy + compatibility predicate.
 *
 * Mirrors ``plcopen/definitions.py:84-119`` (`TypeHierarchy_list`),
 * ``plcopen/structures.py:36-48`` (`IsOfType`), and
 * ``plcopen/structures.py:51-59`` (`GetSubTypes`).
 *
 * The hierarchy is a tree rooted at `"ANY"` with each concrete IEC type
 * (`"INT"`, `"BOOL"`, `"REAL"`, …) attached under its ANY-prefixed
 * meta-parent. `isOfType(child, ancestor)` is true when walking parent
 * pointers from `child` eventually reaches `ancestor`.
 *
 * This is used by `GetBlockType`'s overload resolution: given a call like
 * `ADD(myInt, myInt)` with signature `(ANY_NUM, ANY_NUM) -> ANY_NUM`, each
 * input is type-checked via `isOfType("INT", "ANY_NUM")`.
 *
 * Note on WSTRING: Python's hierarchy comments-out `("WSTRING", "ANY_STRING")`
 * with a TODO. We preserve that — WSTRING returns false for any IsOfType
 * lookup against ancestors except itself.
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
  // WSTRING intentionally absent — matches Python's `# TODO` comment.
}

/**
 * Returns `true` iff `type` is `reference` or any of its subtypes (walking
 * the parent chain). `null` `reference` returns `true` ("matches anything"),
 * mirroring Python's `if reference is None: return True`.
 *
 * Unknown types (not in the hierarchy) return `false` against any
 * reference except themselves. Same behavior as Python where the unknown
 * type raises `KeyError` on the hierarchy lookup — we soften to `false` so
 * derived user types (e.g. `Irrigation_State`) don't crash overload checks.
 */
export function isOfType(type: string, reference: string | null): boolean {
  if (reference === null) return true
  if (type === reference) return true
  const parent = TypeHierarchy[type]
  if (parent === undefined) return false // user-defined type, not in hierarchy
  if (parent === null) return false // reached ANY without matching
  return isOfType(parent, reference)
}

/**
 * Concrete (non-ANY-prefixed) types that are subtypes of `metaType`.
 * Used by `get_standard_funtions` to expand polymorphic CSV signatures into
 * concrete overload entries (e.g. `(ANY_NUM, ANY_NUM)` becomes one entry per
 * `INT`, `SINT`, `DINT`, …). Catalog already pre-expanded; this stays in TS
 * for completeness and future use.
 */
export function getSubTypes(metaType: string): string[] {
  const out: string[] = []
  for (const typename of Object.keys(TypeHierarchy)) {
    if (typename.startsWith('ANY')) continue
    if (isOfType(typename, metaType)) out.push(typename)
  }
  return out
}
