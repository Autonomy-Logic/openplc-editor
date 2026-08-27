// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Serialise a leaf list into the Python layout table.
 *
 * This is the ONLY project-specific thing the generated `.py` contains. The code
 * that reads it is fixed (`python-shm-runtime.ts`), so a new type shape adds rows
 * and nothing else — no new decode branch, no new format-string rule, no new
 * construction path.
 *
 * The table lives in the `.py` rather than in shared memory or a sidecar file
 * because it is static and the `.py` is not a separate deployment artifact: it
 * is embedded in the firmware as a C string literal and written to disk by
 * `python_block_loader`, i.e. by the very code that owns the packed struct. The
 * table and the struct therefore ship in one binary and cannot go stale relative
 * to each other, which is what a shared-memory header or a `.map` file would
 * have been guarding against.
 *
 * Offsets are the running sum of the packed widths, which is exactly what
 * `#pragma pack(push, 1)` gives the C struct emitted from the same leaf list in
 * the same order. The runtime asserts the total against the real segment size at
 * startup, so a disagreement stops the block instead of misreading it.
 */

import type { ShmLeaf } from './shm-leaves'

/** Python literal for one path segment: an index stays a number, a name quotes. */
const segmentLiteral = (segment: string | number): string =>
  typeof segment === 'number' ? String(segment) : `'${segment}'`

/** A Python tuple, with the trailing comma a one-element tuple needs. */
const tupleLiteral = (items: readonly string[]): string =>
  items.length === 1 ? `(${items[0]},)` : `(${items.join(', ')})`

/**
 * `struct` format character for a scalar, or the marker the runtime dispatches
 * strings on.
 *
 * A string is not one `struct` item but a length and a body, so it cannot be
 * expressed as a format character — which is the whole reason the old global
 * format string could not describe an array of them.
 */
const kindLiteral = (leaf: ShmLeaf): string => {
  if (leaf.descriptor.kind === 'string') return `'str'`
  if (leaf.descriptor.kind === 'wstring') return `'wstr'`
  return `'${leaf.descriptor.pyFormat}'`
}

/** Packed width of a leaf list — the offset just past its last field. */
export const layoutTotalBytes = (leaves: readonly ShmLeaf[]): number =>
  leaves.reduce((total, leaf) => total + leaf.descriptor.size, 0)

/**
 * The layout table for one direction, as a Python literal.
 *
 * One row per leaf, in leaf order, which is the order the packed struct declares
 * its fields in. Empty is a real case — a block with no inbound variables — and
 * renders as an empty tuple so the runtime needs no special case.
 */
export const renderLayoutTable = (name: string, leaves: readonly ShmLeaf[]): string => {
  if (leaves.length === 0) return `${name} = ()`

  let offset = 0
  const rows = leaves.map((leaf) => {
    const path = tupleLiteral(leaf.path.map(segmentLiteral))
    const objectPath = tupleLiteral(leaf.objectPath.map((cls) => (cls === null ? 'None' : `'${cls}'`)))
    const enumClass = leaf.enumTypeName ? `'${leaf.enumTypeName}'` : 'None'
    const row = `    (${path}, ${objectPath}, ${kindLiteral(leaf)}, ${offset}, ${leaf.descriptor.size}, ${enumClass}),`
    offset += leaf.descriptor.size
    return row
  })

  return [
    `# (path, objectPath, kind, offset, size, enumClass) — one row per scalar,`,
    `# in the order the packed struct declares its fields.`,
    `${name} = (`,
    ...rows,
    ')',
  ].join('\n')
}
