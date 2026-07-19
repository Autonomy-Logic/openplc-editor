/**
 * Standard block-library resolution against the pre-built catalog.
 *
 * The full python pipeline resolves block types from three sources —
 * TC6 function-block library XMLs, `iec_std.csv` overloads, and
 * project-local POUs.  The first two are baked into
 * `data/std_block_catalog.json` at build time
 * (`tools/build_std_catalog.py`); the third is intentionally dropped
 * here because the only caller (`emit/pou-graphical.ts`) resolves
 * project POUs separately via `project.pous.find(...)`.
 *
 * Overload behaviour mirrors the python oracle's display mode: when
 * a name has multiple catalog entries (ADD, GT, …), the result has
 * all I/O collapsed to `'ANY'`.  The wrap then narrows via its own
 * type-resolution pass.
 */

import stdCatalog from '../data/std_block_catalog.json'

export interface BlockIO {
  name: string
  type: string
  qualifier: 'none' | 'negated' | 'rising' | 'falling'
}

export interface BlockInfos {
  name: string
  type: 'function' | 'functionBlock' | 'program' | string
  extensible: boolean
  inputs: BlockIO[]
  outputs: BlockIO[]
  comment: string
  usage: string
}

export interface BlockResolution {
  source: 'standard'
  infos: BlockInfos
}

interface CatalogEntry {
  section: string
  infos: BlockInfos
}

const CATALOG: ReadonlyMap<string, readonly CatalogEntry[]> = (() => {
  const map = new Map<string, CatalogEntry[]>()
  for (const [name, entries] of Object.entries(stdCatalog as Record<string, CatalogEntry[]>)) {
    map.set(name, entries)
  }
  return map
})()

/**
 * Look the block name up in the standard catalog.  Single match →
 * return its infos.  Multiple matches → return the first entry with
 * all I/O types collapsed to `'ANY'` (the wrap re-narrows).  No
 * match → `null`.
 */
export function resolveBlockType(typename: string): BlockResolution | null {
  const entries = CATALOG.get(typename) ?? []
  let result: BlockInfos | null = null
  for (const entry of entries) {
    if (result !== null) return { source: 'standard', infos: collapseToAny(result) }
    result = cloneBlockInfos(entry.infos)
  }
  return result === null ? null : { source: 'standard', infos: result }
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

/**
 * Destination types of the IEC 61131-3 polymorphic conversion family
 * (`TO_BOOL`, `TO_INT`, `TO_UINT`, …).  Hard-coded here rather than
 * derived at runtime from the catalog so any future addition is visible
 * in code review.  Kept in sync with `data/std_block_catalog.json` — any
 * `<SRC>_TO_<X>` entry in the catalog implies `TO_<X>` is a valid
 * polymorphic conversion target.
 *
 * Shared by both consumers that need to resolve a `TO_<X>` shorthand:
 * `emit/pou-graphical.ts` (output-temp declared type — destination side
 * only) and `walker/ld.ts` (the actual ST function-call name — needs
 * both source and destination).
 */
export const TO_CONVERSION_TARGETS: ReadonlySet<string> = new Set([
  'BCD',
  'BOOL',
  'BYTE',
  'DATE',
  'DINT',
  'DT',
  'DWORD',
  'INT',
  'LINT',
  'LREAL',
  'LWORD',
  'REAL',
  'SINT',
  'STRING',
  'TIME',
  'TOD',
  'UDINT',
  'UINT',
  'ULINT',
  'USINT',
  'WORD',
])

/**
 * Resolve a polymorphic `TO_<TYPE>` block name (e.g. `TO_INT`) to the
 * concrete, fully-qualified IEC 61131-3 conversion function (e.g.
 * `REAL_TO_INT`) given the type of whatever is wired into its single
 * input.
 *
 * IEC 61131-3 does not define a generic `TO_INT` — only the fully
 * qualified `<SRC>_TO_<DST>` family exists (see `std_block_catalog.json`,
 * which enumerates ~20 source variants per destination type but never a
 * bare `TO_<TYPE>` entry).  A block instance whose type name is still the
 * generic shorthand at code-generation time hasn't been resolved to a
 * concrete variant — a real ST/C compiler (matiec, STruC++) rejects the
 * bare name as an undefined function.
 *
 * Returns `null` when `blockTypeName` isn't a recognised polymorphic
 * shorthand, or when `<sourceType>_TO_<DST>` isn't an actual catalog
 * entry (e.g. the source type doesn't have a defined conversion to the
 * destination) — callers should fall back to the original name so an
 * unresolvable case still surfaces the same "undefined function" error
 * it would have before, rather than silently emitting a different wrong
 * name.
 */
export function resolveConversionFunctionName(blockTypeName: string, sourceType: string): string | null {
  const match = blockTypeName.match(/^TO_([A-Z][A-Z0-9]*)$/)
  if (match === null || !TO_CONVERSION_TARGETS.has(match[1])) return null
  const candidate = `${sourceType.toUpperCase()}_TO_${match[1]}`
  return resolveBlockType(candidate) !== null ? candidate : null
}
