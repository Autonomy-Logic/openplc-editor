import { BaseXml } from '@root/types/PLC/xml-data/codesys/base-diagram'

import formatDate from '../../../formatDate'

const getBaseCodeSysXmlStructure = (): BaseXml => ({
  project: {
    '@xmlns': 'http://www.plcopen.org/xml/tc6_0200',
    fileHeader: {
      '@companyName': 'Unknown',
      '@productName': 'Unnamed',
      '@productVersion': '1',
      '@creationDateTime': formatDate(new Date()),
    },
    contentHeader: {
      '@name': 'Unnamed',
      '@modificationDateTime': formatDate(new Date()),
      coordinateInfo: {
        fbd: {
          scaling: {
            '@x': '16',
            '@y': '16',
          },
        },
        ld: {
          scaling: {
            '@x': '16',
            '@y': '16',
          },
        },
        sfc: {
          scaling: {
            '@x': '16',
            '@y': '16',
          },
        },
      },
    },

    types: {
      dataTypes: {
        dataType: [],
      },
      pous: {
        pou: [],
      },
    },

    instances: {
      configurations: {
        configuration: {
          '@name': 'Config0',
          resource: {
            '@name': 'Res0',
            task: [],
          },
        },
      },
    },
  },
})

export { getBaseCodeSysXmlStructure }
