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
