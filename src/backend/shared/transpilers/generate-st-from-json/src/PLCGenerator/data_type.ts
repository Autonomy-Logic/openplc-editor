/**
 * Data type introspection — the project-level `<dataType>` resolver.
 *
 * Mirrors `PLCControler.GetDataTypeInfos` (PLCControler.py:1675) plus the
 * tiny `ComputeDataTypeName` helper (plcopen/types_enums.py:107). Returns
 * a structural descriptor for one of the five PLCOpen data-type variants:
 * Subrange, Enumerated, Array, Structure, Directly.
 *
 * Consumed by Phase 2d.3 `getVariableType` dot-path traversal — given a
 * struct-typed variable like `personRecord.age`, the walker bounces between
 * `GetBlockType` (FB I/O lookup) and `GetDataTypeInfos` (struct field
 * lookup) until the leaf type is resolved.
 */

import {
  getbaseType,
  getcontentOfType,
  getdataType,
  getdataTypeBaseType,
  getdimension,
  getenumValues,
  getinitialValue,
  getlower,
  getname,
  getstructVariables,
  getsubrangeRange,
  gettype,
  getupper,
} from '../plcopen/accessors'
import type { ProjectTree } from '../plcopen/plcopen'
import {
  childElements,
  type Element,
  findChildren,
  getAttr,
  getLocalTag,
} from '../xmlclass/xsdschema'

/**
 * `"D::" + name` — the namespace prefix `GetDataTypeInfos` keys on to know
 * the lookup belongs in `<dataTypes>` rather than POU types.
 */
export function ComputeDataTypeName(datatype: string): string {
  return `D::${datatype}`
}

/* ─────────────────────────── descriptor model ────────────────────────────── */

/**
 * Struct field type. Either a string (elementary uppercase or derived name)
 * or an inline-array tuple `['array', baseType, dimensions]`. Mirrors the
 * Python shape verbatim — JSON serializes the tuple as a 3-array which
 * stays comparable across implementations.
 */
export type StructFieldType =
  | string
  | readonly ['array', string, readonly (readonly [string, string])[]]

export interface StructElement {
  Name: string
  Type: StructFieldType
  'Initial Value': string
}

export type DataTypeInfos =
  | { type: 'Subrange'; min: string; max: string; base_type: string; initial: string }
  | { type: 'Enumerated'; values: string[]; initial: string }
  | {
      type: 'Array'
      dimensions: (readonly [string, string])[]
      base_type: string
      initial?: string
    }
  | { type: 'Structure'; elements: StructElement[]; initial: string }
  | { type: 'Directly'; base_type: string; initial: string }

/* ──────────────────────── GetDataTypeInfos ───────────────────────────────── */

/**
 * Look up the type with `tagname` (e.g. `"D::person_type"`) in the project's
 * `<dataTypes>` and return its descriptor, or `null` if no such type exists.
 *
 * Mirrors `PLCControler.GetDataTypeInfos` (PLCControler.py:1675). Only the
 * `"D::"` namespace is supported — `"P::"` (POUs) is handled by the block
 * library path, not this function.
 */
export function GetDataTypeInfos(
  project: ProjectTree | Element,
  tagname: string,
): DataTypeInfos | null {
  const words = tagname.split('::')
  if (words[0] !== 'D' || words[1] === undefined) return null
  const datatype = getdataType(project, words[1])
  if (!datatype) return null
  const baseWrapper = getdataTypeBaseType(datatype)
  if (!baseWrapper) return null
  const baseContent = getcontentOfType(baseWrapper)
  if (!baseContent) return null

  const infos = readBaseContent(baseContent)
  if (infos === null) return null

  // Real Python always sets `initial`, defaulting to empty string. Mirrors
  // PLCControler.py:1762-1765 + the XSD-generated `getvalue()` recursive
  // formatter on the inner content.
  const initialEl = getinitialValue(datatype)
  ;(infos as { initial: string }).initial = formatInitialValue(initialEl)

  return infos
}

/* ──────────────────── recursive initial-value formatter ─────────────────── */

/**
 * Format a `<initialValue>` element into the Python-equivalent string form:
 *   - `<simpleValue value="X"/>`             → `"X"`
 *   - `<arrayValue><value>…</value>…</…>`    → `"[v1, v2, …]"`
 *     (with `<value repetitionValue="N">`     → `"N(v)"` shorthand)
 *   - `<structValue><value member="x">…</…>` → `"(x := v, …)"`
 *
 * Mirrors `plcopen/plcopen.py:3398-3444`.
 */
function formatInitialValue(ivEl: Element | null): string {
  if (!ivEl) return ''
  const inner = childElements(ivEl)
  if (inner.length === 0) return ''
  return formatValueContent(inner[0])
}

function formatValueContent(content: Element): string {
  const tag = getLocalTag(content)
  if (tag === 'simpleValue') {
    return getAttr(content, 'value') ?? ''
  }
  if (tag === 'arrayValue') {
    const parts: string[] = []
    for (const valueEl of findChildren(content, 'value')) {
      const repRaw = getAttr(valueEl, 'repetitionValue')
      let repetition = 1
      if (repRaw !== null) {
        const parsed = Number.parseInt(repRaw, 10)
        if (Number.isFinite(parsed)) repetition = parsed
      }
      const innerKids = childElements(valueEl)
      const innerVal = innerKids.length > 0 ? formatValueContent(innerKids[0]) : ''
      parts.push(repetition > 1 ? `${repetition}(${innerVal})` : innerVal)
    }
    return `[${parts.join(', ')}]`
  }
  if (tag === 'structValue') {
    const parts: string[] = []
    for (const valueEl of findChildren(content, 'value')) {
      const member = getAttr(valueEl, 'member') ?? ''
      const innerKids = childElements(valueEl)
      const innerVal = innerKids.length > 0 ? formatValueContent(innerKids[0]) : ''
      parts.push(`${member} := ${innerVal}`)
    }
    return `(${parts.join(', ')})`
  }
  return ''
}

function readBaseContent(content: Element): DataTypeInfos | null {
  const tag = getLocalTag(content)

  if (tag === 'subrangeSigned' || tag === 'subrangeUnsigned') {
    const range = getsubrangeRange(content)
    if (!range) return null
    const innerBaseWrap = getbaseType(content)
    if (!innerBaseWrap) return null
    const innerBase = getcontentOfType(innerBaseWrap)
    if (!innerBase) return null
    const innerTag = getLocalTag(innerBase)
    return {
      type: 'Subrange',
      min: getlower(range) ?? '',
      max: getupper(range) ?? '',
      base_type: innerTag === 'derived' ? getname(innerBase) ?? '' : innerTag,
      initial: '',
    }
  }

  if (tag === 'enum') {
    return {
      type: 'Enumerated',
      values: getenumValues(content)
        .map((v) => getname(v))
        .filter((n): n is string => n !== null),
      initial: '',
    }
  }

  if (tag === 'array') {
    const dims = getdimension(content).map(
      (d) => [getlower(d) ?? '', getupper(d) ?? ''] as const,
    )
    const innerBaseWrap = getbaseType(content)
    if (!innerBaseWrap) return null
    const innerBase = getcontentOfType(innerBaseWrap)
    if (!innerBase) return null
    const innerTag = getLocalTag(innerBase)
    return {
      type: 'Array',
      dimensions: dims,
      base_type:
        innerTag === 'derived' ? getname(innerBase) ?? '' : innerTag.toUpperCase(),
      initial: '',
    }
  }

  if (tag === 'struct') {
    const elements: StructElement[] = []
    for (const variable of getstructVariables(content)) {
      const elementInfos = readStructElement(variable)
      if (elementInfos) elements.push(elementInfos)
    }
    return { type: 'Structure', elements, initial: '' }
  }

  // Directly-derived: <derived name="X"/> or elementary.
  return {
    type: 'Directly',
    base_type: tag === 'derived' ? getname(content) ?? '' : tag.toUpperCase(),
    initial: '',
  }
}

function readStructElement(variable: Element): StructElement | null {
  const name = getname(variable)
  if (name === null) return null
  const typeEl = gettype(variable)
  if (!typeEl) return null
  const elementType = getcontentOfType(typeEl)
  if (!elementType) return null

  let resolvedType: StructFieldType
  const tag = getLocalTag(elementType)
  if (tag === 'array') {
    const dimensions = getdimension(elementType).map(
      (d) => [getlower(d) ?? '', getupper(d) ?? ''] as const,
    )
    const innerWrap = getbaseType(elementType)
    const innerEl = innerWrap ? getcontentOfType(innerWrap) : null
    let arrayBase = ''
    if (innerEl) {
      const innerTag = getLocalTag(innerEl)
      arrayBase =
        innerTag === 'derived' ? getname(innerEl) ?? '' : innerTag.toUpperCase()
    }
    resolvedType = ['array', arrayBase, dimensions] as const
  } else if (tag === 'derived') {
    resolvedType = getname(elementType) ?? ''
  } else {
    resolvedType = tag.toUpperCase()
  }

  const ivEl = getinitialValue(variable)
  const initial = formatInitialValue(ivEl)

  return {
    Name: name,
    Type: resolvedType,
    'Initial Value': initial,
  }
}

