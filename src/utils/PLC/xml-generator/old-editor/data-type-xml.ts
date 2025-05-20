import { PLCDataType } from '@root/types/PLC/open-plc'
import { BaseXml } from '@root/types/PLC/xml-data/old-editor'

export const parseDataTypesToXML = (xml: BaseXml, dataTypes: PLCDataType[]) => {
  dataTypes.forEach((dataType) => {
    switch (dataType.derivation) {
      case 'array':
        xml.project.types.dataTypes.dataType.push({
          '@name': dataType.name,
          baseType: {
            array: {
              dimension: dataType.dimensions.map((dimension) => {
                const lower = dimension.dimension.split('..')[0]
                const upper = dimension.dimension.split('..')[1]
                return {
                  '@lower': lower,
                  '@upper': upper,
                }
              }),
              baseType: {
                [dataType.baseType.definition === 'user-data-type'
                  ? 'derived'
                  : dataType.baseType.value === 'string'
                    ? 'string'
                    : dataType.baseType.value.toUpperCase()]:
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
                        [variable.type.value === 'string' ? 'string' : variable.type.value.toUpperCase()]: '',
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
                          dimension: variable.type.data.dimensions.map((dimension) => {
                            const lower = dimension.dimension.split('..')[0]
                            const upper = dimension.dimension.split('..')[1]
                            return {
                              '@lower': lower,
                              '@upper': upper,
                            }
                          }),
                          baseType: {
                            [variable.type.data.baseType.definition === 'user-data-type'
                              ? 'derived'
                              : variable.type.data.baseType.value === 'string'
                                ? 'string'
                                : variable.type.data.baseType.value.toUpperCase()]:
                              variable.type.data.baseType.definition === 'user-data-type'
                                ? { '@name': variable.type.data.baseType.value }
                                : '',
                          },
                        },
                      },
                      initialValue: variable.initialValue
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
                      initialValue: variable.initialValue
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
