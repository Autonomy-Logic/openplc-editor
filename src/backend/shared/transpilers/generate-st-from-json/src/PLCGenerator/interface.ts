/**
 * Compute the variable-interface array of a POU.
 *
 * Mirrors `PouProgramGenerator.ComputeInterface` (PLCGenerator.py:880) **minus
 * its side effects** — Python's version also calls `GeneratePouProgram` and
 * `GenerateDataType` to ensure dependent POUs / data types get emitted, but
 * those belong to later phases. The pure data computation lives here.
 *
 * **Phase 2b.1 scope**: derived-type lookups are recorded by name only; we
 * don't yet distinguish "derived from a function block" from "derived from a
 * user data type". Phase 2d (block library) will revisit. Behavior for
 * elementary, string, wstring, and array types is complete.
 */

import {
  getaddress,
  getconstant,
  getcontentOfType,
  getinitialValue,
  getinterface,
  getinterfaceVarLists,
  getname,
  getnonretain,
  getretain,
  getreturnType,
  gettype,
  getvalue,
  getvariable,
} from '../plcopen/accessors'
import { childElements, type Element, getLocalTag } from '../xmlclass/xsdschema'
import { gettypeAsText, varTypeNames } from './type_text'

/** One declared variable: type, name, optional located address, optional initial value. */
export interface InterfaceVar {
  type: string
  name: string
  address: string | null
  initial: string | null
}

/**
 * One entry of a POU's interface: a group of declarations sharing the same
 * VAR_* keyword and option, split into located (have addresses) vs. non-located.
 *
 * Python stores these as tuples `(keyword, option, located, vars)`; we use a
 * named record so call sites stay readable. The on-disk fixture serializes
 * them as arrays for stable cross-language comparison.
 */
export interface InterfaceEntry {
  keyword: string
  option: 'CONSTANT' | 'RETAIN' | 'NON_RETAIN' | null
  located: boolean
  vars: InterfaceVar[]
}

/**
 * Return type of a FUNCTION POU. `null` for programs and function blocks.
 * Mirrors Python's `self.ReturnType`: the inner type's local tag uppercased,
 * or for `<derived>` the type's `@name`.
 */
export function computeReturnType(pou: Element): string | null {
  const iface = getinterface(pou)
  if (!iface) return null
  const inner = getreturnType(iface)
  if (!inner) return null
  const tag = getLocalTag(inner)
  if (tag === 'derived') return getname(inner) ?? null
  return tag.toUpperCase()
}

/**
 * Walk every varlist in `pou.<interface>` and produce the Interface array
 * (PLCGenerator's `self.Interface`).
 *
 * Variables with `@address` are split into a separate entry with `located = true`,
 * matching Python's two-bucket emit pattern (lines 952-959).
 *
 * Function-block instance variables (those whose `<type>` resolves to a
 * `<derived>` name that names a function block) carry no initial value in
 * Python. Since we can't distinguish FB-derived from data-type-derived
 * without the block library, we conservatively keep `initial` for both;
 * Phase 2d will narrow this once `GetBlockType` is available.
 */
export function computeInterface(pou: Element): InterfaceEntry[] {
  const iface = getinterface(pou)
  if (!iface) return []
  const out: InterfaceEntry[] = []

  for (const varlist of getinterfaceVarLists(iface)) {
    const varlistTag = getLocalTag(varlist)
    const keyword = varTypeNames[varlistTag]
    if (!keyword) continue // Skip unrecognized wrappers.

    const variables: InterfaceVar[] = []
    const located: InterfaceVar[] = []

    for (const variable of getvariable(varlist)) {
      const typeText = resolveDeclaredType(variable)
      if (typeText === null) continue
      const name = getname(variable)
      if (name === null) continue
      const initialValueEl = getinitialValue(variable)
      const initial = initialValueEl ? getvalue(initialValueEl) : null
      const address = getaddress(variable)
      const entry: InterfaceVar = { type: typeText, name, address, initial }
      if (address !== null) located.push(entry)
      else variables.push(entry)
    }

    const option = pickOption(varlist)
    if (variables.length > 0) {
      out.push({ keyword, option, located: false, vars: variables })
    }
    if (located.length > 0) {
      out.push({ keyword, option, located: true, vars: located })
    }
  }

  return out
}

function pickOption(varlist: Element): InterfaceEntry['option'] {
  if (getconstant(varlist)) return 'CONSTANT'
  if (getretain(varlist)) return 'RETAIN'
  if (getnonretain(varlist)) return 'NON_RETAIN'
  return null
}

/**
 * Inline `gettypeAsText`-or-derived-name resolution.
 *
 * Python's `ComputeInterface` branches on `<derived>` vs. elementary types
 * to decide whether to use `vartype_content.getname()` or `gettypeAsText()`.
 * For derived types, the type-name we record is *just the derived name*
 * (no "ARRAY […]" prefix even if the derived type happens to be an array).
 * For everything else, `gettypeAsText` already handles ARRAY / STRING /
 * WSTRING / elementary uniformly.
 */
function resolveDeclaredType(variable: Element): string | null {
  const typeEl = gettype(variable)
  if (!typeEl) return null
  const content = getcontentOfType(typeEl)
  if (!content) return null
  if (getLocalTag(content) === 'derived') {
    return getname(content) ?? null
  }
  return gettypeAsText(variable)
}

/* ────────────────────────── helpers re-exported ──────────────────────────── */

/** Re-export of `childElements` for callers that want it from this module. */
export { childElements }
