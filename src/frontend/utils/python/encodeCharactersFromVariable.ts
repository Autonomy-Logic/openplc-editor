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
  // One format item per leaf, and no repeat counts. A repeat count applies only
  // to the FIRST item of a struct format, so `4b126s` was never four strings —
  // which is why an array of STRING used to emit two slots per element while the
  // decoder consumed one. Every leaf is a single element now, so the arity
  // question does not arise.
  const encoded = leaves.map((leaf) => leaf.descriptor.pyFormat)

  return '=' + encoded.join('')
}

/**
 * `variables` is nullable on purpose. The guard below has always accepted a
 * missing list — a POU with no interface at all reaches here as `undefined` from
 * the older project shapes — but the signature claimed otherwise, so the tests
 * covering that guard had to lie to the compiler with `as unknown as`. Stating
 * it in the type removes the assertion instead of hiding it.
 */
const encodeCharactersFromVariable = (variables: PLCVariable[] | null | undefined, context: ShmWalkContext): string => {
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
