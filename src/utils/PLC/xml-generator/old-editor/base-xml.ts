import { ProjectState } from '@root/renderer/store/slices'
import { BaseXml } from '@root/types/PLC/xml-data/old-editor/base-diagram'
import { create } from 'xmlbuilder2'

import formatDate from '../../../formatDate'
import { instanceToXml } from './instances-xml'
import { parsePousToXML } from './pou-xml'

const getBaseXmlStructure = (): BaseXml => ({
  project: {
    '@xmlns': 'http://www.plcopen.org/xml/tc6_0201',
    '@xmlns:xsd': 'http://www.w3.org/2001/XMLSchema-instance',
    '@xmlns:xhtml': 'http://www.w3.org/1999/xhtml',
    '@xmlns:ns1': 'http://www.plcopen.org/xml/tc6_0201',
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

/**
 * This is not being used anymore.
 * @deprecated
 */
export const parseProjectToXML = (project: ProjectState): string => {
  let xmlResult = getBaseXmlStructure()

  /**
   * Parse POUs
   */
  const pous = project.data.pous
  xmlResult = parsePousToXML(xmlResult, pous)

  /**
   * Parse instances
   */
  const configuration = project.data.configuration
  xmlResult = instanceToXml(xmlResult, configuration)

  const doc = create(xmlResult)
  doc.dec({ version: '1.0', encoding: 'utf-8' })
  const xml = doc.end({ prettyPrint: true })
  return xml
}

export { getBaseXmlStructure }
