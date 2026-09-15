import { PLCVariable } from '@root/middleware/shared/ports/open-plc-types'

import { isGenericType } from '../../generic-types'
import { baseTypeElementBody, baseTypeTag } from '../base-type-tag'

type VariableType = PLCVariable['type']

/**
 * Converts a PLC variable type to its XML representation for the old editor format.
 * Handles base types, arrays, derived types, and user-data-types.
 */
export const convertTypeToXml = (type: VariableType): Record<string, unknown> => {
  if (type.definition === 'array') {
    const baseTypeKey =
      type.data!.baseType.definition === 'user-data-type' ? 'derived' : baseTypeTag(type.data!.baseType.value)
    return {
      array: {
        dimension: type.data!.dimensions.map((dimension) => {
          const lower = dimension.dimension.split('..')[0]
          const upper = dimension.dimension.split('..')[1]
          return {
            '@lower': lower,
            '@upper': upper,
          }
        }),
        baseType: {
          [baseTypeKey]:
            type.data!.baseType.definition === 'user-data-type'
              ? { '@name': type.data!.baseType.value }
              : baseTypeElementBody(type.data!.baseType.value),
        },
      },
    }
  }

  // A generic has an element of its own in the schema's elementaryTypes group.
  // `<derived name="ANY"/>` would name a user-defined type called ANY instead.
  if (isGenericType(type.value)) {
    return { [type.value.trim().toUpperCase()]: '' }
  }

  if (type.definition === 'derived' || type.definition === 'user-data-type') {
    return {
      derived: {
        '@name': type.value,
      },
    }
  }

  // base-type. A declared string length rides on the element as TC6's `length`
  // attribute — `<string length="23"/>` — so it survives a save/load round trip.
  return {
    [baseTypeTag(type.value)]: baseTypeElementBody(type.value),
  }
}
