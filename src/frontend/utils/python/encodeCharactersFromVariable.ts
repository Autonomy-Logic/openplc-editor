// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
import type { PLCVariable } from '../../../middleware/shared/ports/types'
import type { ShmLeaf, ShmWalkContext } from './shm-leaves'
import { describeShmLayout } from './shm-leaves'

/**
 * Convert a POU's interface variables into the format string Python's
 * `struct.pack` / `struct.unpack` use for the shared-memory exchange.
 *
 * The format is built from the same leaf walk the C-side struct emitter uses, so
 * the two descriptions of one layout cannot drift: a structure is flattened into
 * the same fields, in the same order, on both sides.
 *
 * Unsupported types are refused upstream (`preprocessPous`) rather than skipped
 * here. Skipping was the original defect: a dropped field does not merely go
 * missing, it shifts every later field's offset and silently corrupts them.
 *
 * @returns a `struct` format string such as `'=hfb126s'`, native byte order and
 *   no alignment, matching the `#pragma pack(push, 1)` struct on the C side.
 */
const encodeCharactersFromLeaves = (leaves: readonly ShmLeaf[]): string => {
  const encoded = leaves.map((leaf) => {
    if (leaf.isArray) {
      // A repeat count applies only to the FIRST item of a struct format, so
      // `4b126s` is not four strings. Only single-item formats can carry one,
      // which is why the walk refuses an array whose element needs more than
      // one — an array leaf here is always a scalar element.
      return `${leaf.count}${leaf.descriptor.pyFormat}`
    }
    return leaf.descriptor.pyFormat
  })

  return '=' + encoded.join('')
}

const encodeCharactersFromVariable = (variables: PLCVariable[], context: ShmWalkContext): string => {
  if (!variables || variables.length === 0) {
    return '='
  }

  const walked = describeShmLayout(variables, context)
  // Unreachable through the compile path — `preprocessPous` refuses anything
  // that cannot cross before any of this runs. Kept as a total function so a
  // direct caller cannot produce a half-formed layout.
  /* istanbul ignore next -- defensive: refusals stop the build in preprocess-pous */
  if ('refusal' in walked) return '='

  return encodeCharactersFromLeaves(walked.leaves)
}

export { encodeCharactersFromLeaves, encodeCharactersFromVariable }
