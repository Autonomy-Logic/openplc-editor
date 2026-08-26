// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
import type { PLCVariable } from '../../../middleware/shared/ports/types'
import { getArrayTotalElements, isArrayVariable } from '../PLC/array-codegen-helpers'
import { describeShmField } from './shm-type-map'

/**
 * Convert a POU's interface variables into the format string Python's
 * `struct.pack` / `struct.unpack` use for the shared-memory exchange.
 *
 * The per-type formats come from `shm-type-map.ts`, which the C-side struct
 * emitter reads as well — the two sides cannot drift because there is only one
 * table. This function's own job is just repetition and ordering.
 *
 * Unsupported types are refused upstream (`preprocessPous`) rather than skipped
 * here. Skipping was the original defect: a dropped field does not merely go
 * missing, it shifts every later field's offset and silently corrupts them.
 *
 * @returns a `struct` format string such as `'=hfb126s'`, native byte order and
 *   no alignment, matching the `#pragma pack(push, 1)` struct on the C side.
 */
const encodeCharactersFromVariable = (variables: PLCVariable[]): string => {
  if (!variables || variables.length === 0) {
    return '='
  }

  const encodedChars = variables
    .map((variable) => {
      const descriptor = describeShmField(variable)
      if (!descriptor) {
        // Unreachable through the compile path — `preprocessPous` rejects an
        // unsupported type before any of this runs. Kept as a total function so
        // a direct caller cannot produce a half-formed layout.
        return ''
      }

      if (isArrayVariable(variable)) {
        const totalElements = getArrayTotalElements(variable)
        // A repeat count applies only to the FIRST character of a struct
        // format, so `10b126s` is not ten strings. Multi-character formats are
        // repeated whole.
        if (descriptor.pyFormat.length > 1) {
          return descriptor.pyFormat.repeat(totalElements)
        }
        return `${totalElements}${descriptor.pyFormat}`
      }

      return descriptor.pyFormat
    })
    .filter((char) => char !== '')

  return '=' + encodedChars.join('')
}

export { encodeCharactersFromVariable }
