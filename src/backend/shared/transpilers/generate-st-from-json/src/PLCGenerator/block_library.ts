/**
 * Block-library resolution.
 *
 * Phase 2d.1 — project-local POU resolution + permissive synthesis fallback.
 *
 * The full Python pipeline (PLCControler.GetBlockType, PLCGenerator.py:1288)
 * resolves block types across three sources:
 *   1. 10 TC6 function-block library XMLs (TON, TOF, R_TRIG, F_TRIG, …)
 *   2. iec_std.csv (ADD, SUB, AND, OR, GT, EQ, … with overload signatures)
 *   3. The project's own POU definitions
 *
 * Porting (1) and (2) is its own deferred effort (Phase 2d.2): it requires
 * shipping ~MB of XML/CSV data in the bundle and re-implementing overload
 * resolution. For now we cover (3) — every block type the corpus references
 * that *isn't* a project-local POU falls through to
 * `synthesizePermissiveBlockInfos`, matching `xml2st`'s permissive policy
 * (strucpp does real type-checking downstream).
 *
 * This divergence is recorded in `fixtures/INVENTORY.md`.
 */

import {
  getcontentOfType,
  getdescription,
  getformalParameter,
  getinputVariables,
  getinstanceName,
  getinterface,
  getinterfaceVarLists,
  getname,
  getoutputVariables,
  getpou,
  getpouType,
  getreturnType,
  gettype,
  gettypeName,
  getvariable,
} from '../plcopen/accessors'
import type { ProjectTree } from '../plcopen/plcopen'
import { childElements, type Element, getLocalTag, isElement } from '../xmlclass/xsdschema'

/* ───────────────────────────── data model ────────────────────────────────── */

/**
 * `(name, type, qualifier)` triple. Mirrors Python's tuple inside
 * `block_infos["inputs"]` / `["outputs"]`. Qualifier is always `"none"` for
 * project-local POUs and synthesized permissive entries.
 */
export interface BlockIO {
  name: string
  type: string
  qualifier: 'none' | 'negated' | 'rising' | 'falling'
}

/**
 * Shape of Python's `block_infos` dict, identical to `getblockInfos()` and
 * `SynthesizePermissiveBlockInfos` returns.
 */
export interface BlockInfos {
  name: string
  type: 'function' | 'functionBlock' | 'program' | string
  extensible: boolean
  inputs: BlockIO[]
  outputs: BlockIO[]
  comment: string
  usage: string
}

/* ─────────────────────── type-info helper ────────────────────────────────── */

/**
 * Extract a textual IEC type from a `<type>` (or `<returnType>`) wrapper.
 * Mirrors `_getvariableTypeinfos` (plcopen/plcopen.py:1469).
 *
 * Behavior:
 *   - `<derived name="X"/>` → `"X"`
 *   - elementary (`<BOOL/>`, `<INT/>`, `<TIME/>`, …) → local tag UPPERCASED
 *
 * Python doesn't special-case `<string>` / `<wstring>` / `<array>` here
 * because block-interface declarations only carry elementary or derived
 * types; we mirror that, falling through to `local tag UPPERCASED` for
 * anything else (giving `"STRING"`, `"WSTRING"`, `"ARRAY"`).
 */
function variableTypeInfo(typeWrapper: Element): string {
  const content = getcontentOfType(typeWrapper)
  if (!content) return ''
  const tag = getLocalTag(content)
  if (tag === 'derived') return getname(content) ?? ''
  return tag.toUpperCase()
}

/* ──────────────────────── getblockInfos(pou) ─────────────────────────────── */

/**
 * Build a `BlockInfos` from a POU element. Mirrors `getblockInfos()`
 * (plcopen.py:1478).
 *
 * Inputs:  `inputVars` ∪ `inOutVars`
 * Outputs: `outputVars` ∪ `inOutVars`  (yes, inOutVars contribute to both)
 * For FUNCTION POUs: prepend `("OUT", returnType, "none")` to outputs.
 */
export function getblockInfos(pou: Element): BlockInfos {
  const infos: BlockInfos = {
    name: getname(pou) ?? '',
    type: getpouType(pou) ?? '',
    extensible: false,
    inputs: [],
    outputs: [],
    comment: getdescription(pou),
    usage: '',
  }

  const iface = getinterface(pou)
  if (iface) {
    const returnTypeInner = getreturnType(iface)
    if (returnTypeInner) {
      // Python passes the returnType *wrapper*, then `_getvariableTypeinfos`
      // walks one level deeper. Our `getreturnType` already returns the
      // inner element, so we synthesize a temporary view: re-extract via
      // `getLocalTag`. For `derived`, read `@name`; else uppercase the tag.
      const tag = getLocalTag(returnTypeInner)
      const t = tag === 'derived' ? (getname(returnTypeInner) ?? '') : tag.toUpperCase()
      infos.outputs.push({ name: 'OUT', type: t, qualifier: 'none' })
    }

    for (const varlist of getinterfaceVarLists(iface)) {
      const varlistTag = getLocalTag(varlist)
      const isInput = varlistTag === 'inputVars' || varlistTag === 'inOutVars'
      const isOutput = varlistTag === 'outputVars' || varlistTag === 'inOutVars'
      if (!isInput && !isOutput) continue

      for (const variable of getvariable(varlist)) {
        const typeEl = gettype(variable)
        if (!typeEl) continue
        const t = variableTypeInfo(typeEl)
        const name = getname(variable) ?? ''
        const io: BlockIO = { name, type: t, qualifier: 'none' }
        if (isInput) infos.inputs.push(io)
        if (isOutput) infos.outputs.push(io)
      }
    }
  }

  infos.usage = formatUsage(infos)
  return infos
}

/**
 * `"\n (BOOL:IN, TIME:PT) => (BOOL:Q, TIME:ET)"` — the exact format Python
 * builds. Leading newline + single space, `type:name` per entry, comma-space
 * separators.
 */
function formatUsage(infos: BlockInfos): string {
  const ins = infos.inputs.map((i) => `${i.type}:${i.name}`).join(', ')
  const outs = infos.outputs.map((o) => `${o.type}:${o.name}`).join(', ')
  return `\n (${ins}) => (${outs})`
}

/* ──────────────────────── SynthesizePermissive ───────────────────────────── */

/**
 * Build a permissive `BlockInfos` from a graphical `<block>` instance when
 * the type isn't otherwise resolvable. Mirrors
 * `SynthesizePermissiveBlockInfos` (PLCGenerator.py:732).
 *
 * Discriminates `function` vs. `functionBlock` by the presence of an
 * `@instanceName` attribute — PLCopen always emits one for FB instances and
 * never for function calls.
 *
 * Every input/output gets the `"ANY"` type and skips the `EN`/`ENO` ports
 * (they're typed elsewhere as BOOL by the Block branch of
 * `computeConnectionTypes`).
 */
export function synthesizePermissiveBlockInfos(instance: Element): BlockInfos {
  const isFB = getinstanceName(instance) !== null
  const inputWrapper = getinputVariables(instance)
  const outputWrapper = getoutputVariables(instance)
  const inputs: BlockIO[] = inputWrapper
    ? getvariable(inputWrapper)
        .map(
          (v): BlockIO => ({
            name: getformalParameter(v) ?? '',
            type: 'ANY',
            qualifier: 'none',
          }),
        )
        .filter((io) => io.name !== 'EN')
    : []
  const outputs: BlockIO[] = outputWrapper
    ? getvariable(outputWrapper)
        .map(
          (v): BlockIO => ({
            name: getformalParameter(v) ?? '',
            type: 'ANY',
            qualifier: 'none',
          }),
        )
        .filter((io) => io.name !== 'ENO')
    : []
  const infos: BlockInfos = {
    name: gettypeName(instance) ?? '',
    type: isFB ? 'functionBlock' : 'function',
    extensible: false,
    inputs,
    outputs,
    comment: '',
    usage: '',
  }
  // Python's synthesize doesn't fill `usage` (it stays ""); preserve that.
  return infos
}

/* ──────────────────────── GetBlockType ───────────────────────────────────── */

// Editor's tsconfig targets commonjs, which doesn't support
// import-with-attributes; web targets esnext.  The plain default
// import works under both because TS resolves `.json` modules via
// resolveJsonModule.
import stdCatalog from '../../data/std_block_catalog.json'
import { isOfType } from './type_hierarchy'

/**
 * Internal catalog index keyed by typename. Each entry is the ordered list
 * of `{section, infos}` pairs the Python `StdBlckDct` exposes — multiple
 * entries per name happen for overloaded standard functions (ADD, GT, …).
 */
interface CatalogEntry {
  section: string
  infos: BlockInfos
}
const CATALOG: ReadonlyMap<string, readonly CatalogEntry[]> = (() => {
  // The JSON file is generated by `tools/build_std_catalog.py` and shipped
  // as a static asset; here we just index it for O(1) lookups.
  const map = new Map<string, CatalogEntry[]>()
  for (const [name, entries] of Object.entries(stdCatalog as Record<string, CatalogEntry[]>)) {
    map.set(name, entries)
  }
  return map
})()

/** Sentinel value for `inputs` meaning "I don't know the input types". */
export type UndefinedInputs = 'undefined'

/**
 * Which source provided a resolved BlockInfos. Useful for tests, debugging,
 * and INVENTORY tracking. The production `GetBlockType` discards this and
 * returns the infos directly — see `resolveBlockType` for the labeled form.
 */
export type ResolutionSource = 'standard' | 'project'

export interface BlockResolution {
  source: ResolutionSource
  infos: BlockInfos
}

/**
 * Full block-type resolution with source tracking. Mirrors
 * `PLCControler.GetBlockType` (PLCControler.py:1288). Three sources, in order:
 *
 *   1. **Standard catalog** (`shared-backend/.../data/std_block_catalog.json`),
 *      generated from the same TC6 XMLs + `iec_std.csv` the Python pipeline
 *      loads at runtime.
 *   2. **Project-local POU** — `project.getpou(typename)` if not null.
 *   3. Returns `null` (caller falls through to `synthesizePermissive`).
 *
 * `inputs` controls overload selection:
 *   - `null` / `undefined` (default): no narrowing. First catalog entry
 *     wins; if more than one exists, returns a copy with all I/O collapsed
 *     to `"ANY"` (display-mode behavior).
 *   - `"undefined"`: unique-match mode. Multiple entries → returns `null`
 *     (the caller will retry in pass 2 with concrete input types).
 *   - `string[]`: concrete input types. Each call input is matched against
 *     the signature input via `isOfType`. The element `"ANY"` is treated
 *     as a wildcard (skips narrowing for that position).
 */
export function resolveBlockType(
  project: ProjectTree | Element | null,
  typename: string,
  inputs?: readonly string[] | UndefinedInputs | null,
): BlockResolution | null {
  const entries = CATALOG.get(typename) ?? []

  if (Array.isArray(inputs)) {
    for (const entry of entries) {
      const sigInputs = entry.infos.inputs
      const allMatch = inputs.every((callType, idx) => {
        const sig = sigInputs[idx]
        if (sig === undefined) return false
        return callType === 'ANY' || isOfType(callType, sig.type)
      })
      if (allMatch) return { source: 'standard', infos: cloneBlockInfos(entry.infos) }
    }
  } else {
    let result: BlockInfos | null = null
    for (const entry of entries) {
      if (result !== null) {
        if (inputs === 'undefined') return null
        return { source: 'standard', infos: collapseToAny(result) }
      }
      result = cloneBlockInfos(entry.infos)
    }
    if (result !== null) return { source: 'standard', infos: result }
  }

  if (project !== null) {
    const pou = getpou(project, typename)
    if (pou) {
      const infos = getblockInfos(pou)
      if (!Array.isArray(inputs)) {
        return { source: 'project', infos }
      }
      const sigTypes = infos.inputs.map((i) => i.type)
      if (sigTypes.length === inputs.length && sigTypes.every((t, i) => t === inputs[i])) {
        return { source: 'project', infos }
      }
    }
  }

  return null
}

/**
 * Convenience wrapper returning just the BlockInfos — the primary API used
 * by `computeConnectionTypes` and the rest of the pipeline.
 */
export function GetBlockType(
  project: ProjectTree | Element | null,
  typename: string,
  inputs?: readonly string[] | UndefinedInputs | null,
): BlockInfos | null {
  return resolveBlockType(project, typename, inputs)?.infos ?? null
}

function cloneBlockInfos(infos: BlockInfos): BlockInfos {
  return {
    name: infos.name,
    type: infos.type,
    extensible: infos.extensible,
    inputs: infos.inputs.map((i) => ({ ...i })),
    outputs: infos.outputs.map((o) => ({ ...o })),
    comment: infos.comment,
    usage: infos.usage,
  }
}

function collapseToAny(infos: BlockInfos): BlockInfos {
  return {
    ...infos,
    inputs: infos.inputs.map((i) => ({ ...i, type: 'ANY' })),
    outputs: infos.outputs.map((o) => ({ ...o, type: 'ANY' })),
  }
}

/* ──────────────────────── re-exports for tests ───────────────────────────── */

/** Helper for tests — count children of any element. */
export function childElementCount(el: Element): number {
  let n = 0
  for (let i = 0; i < el.childNodes.length; i++) {
    const child = el.childNodes.item(i)
    if (child && isElement(child)) n++
  }
  return n
}
// Re-export so test files can import without reaching into xsdschema.
export { childElements }
