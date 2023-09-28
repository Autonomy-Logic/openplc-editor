export interface xmlProject {
  version: string
  encoding: string // {version: '1.0', encoding: 'utf-8'}
  project: {
    '@xmlns:ns1': string // 'http://www.plcopen.org/xml/tc6.xsd'
    '@xmlns:xhtml': string // 'http://www.w3.org/1999/xhtml'
    '@xmlns:xsd': string // 'http://www.w3.org/2001/XMLSchema'
    '@xmlns': string // 'http://www.plcopen.org/xml/tc6_0201'
    fileHeader: {
      '@companyName': string // 'Unknown'
      '@productName': string // 'Unnamed'
      '@productVersion': string // '1'
      '@creationDateTime': string // '2023-07-03T20:25:15'
    }
    contentHeader: {
      '@name': string // 'Unnamed'
      '@modificationDateTime': string // '2023-07-03T20:25:15'
      coordinateInfo: {
        fbd: {
          scaling: {
            '@x': string // '10'
            '@y': string // '10'
          }
        }
        ld: {
          scaling: {
            '@x': string // '10'
            '@y': string // '10'
          }
        }
        sfc: {
          scaling: {
            '@x': string // '10'
            '@y': string // '10'
          }
        }
      }
    }
    types: {
      dataTypes: object // todo: Create the shape of this obj based on OpenPLC Editor xml
      pous: {
        pou: {
          '@name': string // 'program0'
          '@pouType': string // 'program'
          body: object
        }
      }
    }
    instances: {
      configurations: {
        configuration: {
          '@name': string // 'Config0'
          resource: {
            '@name': string // 'Res0'
            task: {
              '@name': string // 'task0'
              '@priority': string // '0'
              '@interval': string // 'T#20ms'
              pouInstance: {
                '@name': string // 'instance0'
                '@typeName': string // 'program0'
              }
            }
          }
        }
      }
    }
  }
}

// Wip: Implements bodydata shape based on the type of POU instance.

type IGraphicalLangs = 'FBD' | 'SFC' | 'LD'
type ITextualLangs = 'IL' | 'ST'

interface IGraphicalPou {
  leftPowerRail: {
    '@localId': string // '1'
    '@heigh': string // '40'
    '@width': string // '10'
    position: {
      '@x': string // '200'
      '@y': string // '200'
    }
    connectionPointOut: {
      '@formalParameter': string //  ''
      relPosition: {
        '@x': string // '10'
        '@y': string // '20'
      }
    }
  }
  rightPowerRail: {
    '@localId': string // '2'
    '@heigh': string // '40'
    '@width': string // '10'
    position: {
      '@x': string // '800'
      '@y': string // '200'
    }
    connectionPointIn: {
      relPosition: {
        '@x': string // '0'
        '@y': string // '20'
      }
      connection: {
        '@refLocalId': string // '1'
        position: [
          {
            '@x': string // '800'
            '@y': string // '220
          },
          {
            '@x': string // '210'
            '@y': string // '220'
          },
        ]
      }
    }
  }
}
interface ITextualPou {
  '@[CDATA]': string
}

type BodyData<T extends IGraphicalPou | ITextualPou> = T extends IGraphicalPou
  ? IGraphicalLangs
  : ITextualLangs
