/**
 * Debug map parser — Phase 4 (STruC++) debug-map.json.
 *
 * STruC++ writes a debug-map.json alongside generated_debug.cpp at compile
 * time. This module parses it and exposes helpers to pack/unpack the
 * (arrayIdx, elemIdx) leaf addresses into the single-number representation
 * the editor's store, polling loop, and Modbus clients already consume.
 */

/** One leaf variable in the runtime's Phase 4 debug address space. */
export interface DebugAddr {
  arrayIdx: number
  elemIdx: number
}

export interface DebugMapLeaf {
  arrayIdx: number
  elemIdx: number
  path: string
  type: string
  size: number
}

export interface DebugMap {
  /** Wire-schema version. Bumped when the file format changes in a
   *  non-backward-compatible way. */
  version: 2
  md5: string
  typeTags: Record<string, number>
  arrays: Array<{ index: number; count: number }>
  leaves: DebugMapLeaf[]
}

/**
 * One DebugVariableEntry per leaf — the shape the tree builder consumes.
 * `index` carries the packed (arr<<16|elem) DebugAddr so downstream code
 * (polling loop, modbus clients) keeps a plain `number` indirection.
 */
export interface DebugVariableEntry {
  /** Full path from the instance root (e.g. "INSTANCE0.SPEEDS[5]"). */
  name: string
  /** IEC type tag string with `_ENUM` suffix for compatibility with the
   *  tree-builder's type-name unwrapping (e.g. "INT_ENUM", "BOOL_ENUM"). */
  type: string
  /** Packed DebugAddr (arrayIdx << 16 | elemIdx). */
  index: number
}

/**
 * Pack a DebugAddr into a single number for APIs that carry a flat index.
 * arr goes in the high byte, elem in the low 16 bits: `(arr << 16) | elem`.
 */
export function packDebugAddr(addr: DebugAddr): number {
  return ((addr.arrayIdx & 0xff) << 16) | (addr.elemIdx & 0xffff)
}

/** Inverse of packDebugAddr — handy in tooltips and tests. */
export function unpackDebugAddr(packed: number): DebugAddr {
  return {
    arrayIdx: (packed >>> 16) & 0xff,
    elemIdx: packed & 0xffff,
  }
}

/**
 * Parse debug-map.json. Returns undefined if the content is missing or
 * malformed so callers can surface a clean error.
 */
export function parseDebugMap(content: string): DebugMap | undefined {
  try {
    const raw = JSON.parse(content) as Partial<DebugMap>
    if (raw.version !== 2 || !Array.isArray(raw.leaves) || !Array.isArray(raw.arrays)) {
      return undefined
    }
    return raw as DebugMap
  } catch {
    return undefined
  }
}
