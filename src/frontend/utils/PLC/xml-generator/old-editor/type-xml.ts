import { PLCVariable } from '@root/middleware/shared/ports/open-plc-types'

import { baseTypeTag } from '../base-type-tag'

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
            type.data!.baseType.definition === 'user-data-type' ? { '@name': type.data!.baseType.value } : '',
        },
      },
    }
  }

  if (type.definition === 'derived' || type.definition === 'user-data-type') {
    return {
      derived: {
        '@name': type.value,
      },
    }
  }

  // base-type
  return {
    [baseTypeTag(type.value)]: '',
  }
}
