import { PLCDataType } from '@root/middleware/shared/ports/open-plc-types'
import { BaseXml } from '@root/middleware/shared/ports/xml-types/codesys'

import { baseTypeTag } from '../base-type-tag'

const parseDimensions = (dimensions: Array<{ dimension: string }>) => {
  return (
    dimensions?.map((dimension) => {
      if (!dimension?.dimension || typeof dimension.dimension !== 'string') {
        throw new Error(`Invalid dimension format: ${dimension.dimension}`)
      }
      const [lower, upper] = dimension.dimension.split('..')
      if (!lower || !upper) {
        throw new Error(`Invalid dimension range: ${dimension.dimension}`)
      }
      return { '@lower': lower, '@upper': upper }
    }) || []
  )
}

export const codeSysParseDataTypesToXML = (xml: BaseXml, dataTypes: PLCDataType[]) => {
  dataTypes.forEach((dataType) => {
    switch (dataType.derivation) {
      case 'array':
        xml.project.types.dataTypes.dataType.push({
          '@name': dataType.name,
          baseType: {
            array: {
              dimension: parseDimensions(dataType.dimensions),
              baseType: {
                [dataType.baseType.definition === 'user-data-type' ? 'derived' : baseTypeTag(dataType.baseType.value)]:
                  dataType.baseType.definition === 'user-data-type' ? { '@name': dataType.baseType.value } : '',
              },
            },
          },
          initialValue: dataType.initialValue
            ? {
                simpleValue: {
                  '@value': dataType.initialValue,
                },
              }
            : undefined,
        })
        break

      case 'enumerated':
        xml.project.types.dataTypes.dataType.push({
          '@name': dataType.name,
          baseType: {
            enum: {
              values: {
                value: dataType.values.map((value) => {
                  return {
                    '@name': value.description,
                  }
                }),
              },
            },
          },
          initialValue: dataType.initialValue
            ? {
                simpleValue: {
                  '@value': dataType.initialValue,
                },
              }
            : undefined,
        })
        break

      case 'structure':
        xml.project.types.dataTypes.dataType.push({
          '@name': dataType.name,
          baseType: {
            struct: {
              variable: dataType.variable.map((variable) => {
                switch (variable.type.definition) {
                  case 'base-type':
                    return {
                      '@name': variable.name,
                      type: {
                        [baseTypeTag(variable.type.value)]: '',
                      },
                      initialValue: variable.initialValue?.simpleValue.value
                        ? {
                            simpleValue: {
                              '@value': variable.initialValue?.simpleValue.value,
                            },
                          }
                        : undefined,
                    }
                  case 'user-data-type':
                    return {
                      '@name': variable.name,
                      type: {
                        derived: { '@name': variable.type.value },
                      },
                      initialValue: variable.initialValue?.simpleValue.value
                        ? {
                            simpleValue: {
                              '@value': variable.initialValue?.simpleValue.value,
                            },
                          }
                        : undefined,
                    }
                  case 'array':
                    return {
                      '@name': variable.name,
                      type: {
                        array: {
                          dimension: parseDimensions(variable.type.data!.dimensions),
                          baseType: {
                            [variable.type.data!.baseType.definition === 'user-data-type'
                              ? 'derived'
                              : baseTypeTag(variable.type.data!.baseType.value)]:
                              variable.type.data!.baseType.definition === 'user-data-type'
                                ? { '@name': variable.type.data!.baseType.value }
                                : '',
                          },
                        },
                      },
                      initialValue: variable.initialValue?.simpleValue.value
                        ? {
                            simpleValue: {
                              '@value': variable.initialValue.simpleValue.value,
                            },
                          }
                        : undefined,
                    }
                  case 'derived':
                    return {
                      '@name': variable.name,
                      type: {
                        derived: { '@name': variable.type.value },
                      },
                      initialValue: variable.initialValue?.simpleValue.value
                        ? {
                            simpleValue: {
                              '@value': variable.initialValue.simpleValue.value,
                            },
                          }
                        : undefined,
                    }
                }
              }),
            },
          },
        })
    }
  })

  return xml
}
