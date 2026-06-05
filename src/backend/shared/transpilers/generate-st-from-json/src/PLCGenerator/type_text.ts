/**
 * Constants and helpers for variable / literal type inference.
 *
 * Mirrors:
 *   - `LITERAL_TYPES`        (PLCGenerator.py:961)
 *   - `varTypeNames`         (PLCGenerator.py:38)
 *   - `gettypeAsText`        (plcopen/plcopen.py:1100)
 */

import { getbaseType, getcontentOfType, getdimension, getlower, getname, gettype, getupper } from '../plcopen/accessors'
import { childElements, type Element, getLocalTag, isElement } from '../xmlclass/xsdschema'

/**
 * Literal-prefix → IEC type mapping. `T#…`, `D#…`, `TOD#…`, `DT#…` are
 * datetime literals; `2#`, `8#`, `16#` are base-N integer literals (the
 * concrete type is determined elsewhere, so we map them to `null` like
 * Python does).
 */
export const LITERAL_TYPES: Readonly<Record<string, string | null>> = {
  T: 'TIME',
  D: 'DATE',
  TOD: 'TIME_OF_DAY',
  DT: 'DATE_AND_TIME',
  '2': null,
  '8': null,
  '16': null,
}

/**
 * PLCOpen varlist localName → IEC 61131-3 declaration keyword.
 * Identical to Python's `varTypeNames`.
 */
export const varTypeNames: Readonly<Record<string, string>> = {
  localVars: 'VAR',
  tempVars: 'VAR_TEMP',
  inputVars: 'VAR_INPUT',
  outputVars: 'VAR_OUTPUT',
  inOutVars: 'VAR_IN_OUT',
  externalVars: 'VAR_EXTERNAL',
  globalVars: 'VAR_GLOBAL',
  accessVars: 'VAR_ACCESS',
}

/**
 * Textual representation of a `<variable>`'s declared type.
 *
 * Mirrors `gettypeAsText` (plcopen/plcopen.py:1100):
 *   - `<derived name="X"/>`   → `"X"`
 *   - `<string/>` / `<wstring/>` → uppercased (`"STRING"` / `"WSTRING"`)
 *   - `<array>...</array>`    → `"ARRAY [lower..upper, …] OF basetype"`
 *   - elementary (`<BOOL/>`, `<INT/>`, …) → the local tag verbatim
 *
 * Returns `null` if the variable has no `<type>` child or the type wrapper
 * is empty — caller treats this the same as an unresolvable type.
 */
export function gettypeAsText(variable: Element): string | null {
  const typeEl = gettype(variable)
  if (!typeEl) return null
  const content = getcontentOfType(typeEl)
  if (!content) return null
  return contentToText(content)
}

function contentToText(content: Element): string {
  const tag = getLocalTag(content)
  if (tag === 'derived') {
    return getname(content) ?? ''
  }
  if (tag === 'string' || tag === 'wstring') {
    return tag.toUpperCase()
  }
  if (tag === 'array') {
    return arrayToText(content)
  }
  return tag
}

function arrayToText(arrayContent: Element): string {
  const dims = getdimension(arrayContent)
    .map((d) => `${getlower(d) ?? ''}..${getupper(d) ?? ''}`)
    .join(',')
  const baseWrapper = getbaseType(arrayContent)
  let baseText = ''
  if (baseWrapper) {
    const base = childElements(baseWrapper).find(isElement)
    if (base) {
      const tag = getLocalTag(base)
      if (tag === 'derived') baseText = getname(base) ?? ''
      else if (tag === 'string' || tag === 'wstring') baseText = tag.toUpperCase()
      else baseText = tag
    }
  }
  return `ARRAY [${dims}] OF ${baseText}`
}
