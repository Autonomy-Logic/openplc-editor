import { ProjectState } from '@root/renderer/store/slices'
import { BaseXml } from '@root/types/PLC/xml-data/base-diagram'
import { create } from 'xmlbuilder2'

import formatDate from '../formatDate'
import { instanceToXml } from './instances-xml'
import { parsePousToXML } from './pou-xml'

export const baseXmlStructure: BaseXml = {
  project: {
    '@xmlns': 'http://www.plcopen.org/xml/tc6_0201',
    '@xmlns:xsd': 'http://www.w3.org/2001/XMLSchema-instance',
    '@xmlns:xhtml': 'http://www.w3.org/1999/xhtml',
    '@xmlns:ns1': 'http://www.plcopen.org/xml/tc6.xsd',
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
            '@x': '10',
            '@y': '10',
          },
        },
        ld: {
          scaling: {
            '@x': '10',
            '@y': '10',
          },
        },
        sfc: {
          scaling: {
            '@x': '10',
            '@y': '10',
          },
        },
      },
    },

    types: {
      dataTypes: '',
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
            globalVars: [],
          },
        },
      },
    },
  },
}

export const parseProjectToXML = (project: ProjectState) => {
  console.log('=-=-=-= PARSING TO XML =-=-=-=')
  console.log('Project:', project)
  let xmlResult = baseXmlStructure

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
  const xml = doc.end({ prettyPrint: true })
  console.log('xml as object', xmlResult)
  console.log(xml)
  console.log('=-=-=-= FINISHED PARSE TO XML =-=-=-=')
}
