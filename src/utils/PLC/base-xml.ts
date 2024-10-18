import { ProjectState, RungState } from '@root/renderer/store/slices'
import { BaseXml } from '@root/types/PLC/xml-data/base-diagram'
import { create } from 'xmlbuilder2'

import formatDate from '../formatDate'
import { ladderToXml } from './ladder-xml'

export const baseXmlStructure: BaseXml = {
  project: {
    '@xmlns': 'http://www.plcopen.org/xml/tc6_0201',
    '@xmlns:xsd': 'http://www.w3.org/2001/XMLSchema-instance',
    '@xmlns:xhtml': 'http://www.w3.org/1999/xhtml',
    '@xmlns:ns1': 'http://www.plcopen.org/xml/tc6.xsd',
    '@xsi:schemaLocation': 'http://www.plcopen.org/xml/tc6_0200 http://www.plcopen.org/xml/tc6_0200',
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
      dataTypes: [],
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
  const xmlResult = baseXmlStructure

  /**
   * Parse POUs
   */
  const pous = project.data.pous
  pous.forEach((pou) => {
    switch (pou.data.body.language) {
      case 'il':
        // parseIL(pou.data.body, xmlResult.project.types.pous.pou)
        break
      case 'st':
        // parseST(pou.data.st, xmlResult.project.types.pous.pou)
        break
      case 'ld': {
        const rungs = pou.data.body.value.rungs
        const result = ladderToXml(rungs as RungState[])
        xmlResult.project.types.pous.pou.push({
          '@name': pou.data.name,
          '@pouType': pou.type === 'function-block' ? 'functionBlock' : pou.type,
          interface: {},
          body: {
            LD: result.body.LD,
          },
          documentation: {
            'xhtml:p': {
              $: pou.data.documentation,
            },
          },
        })
        break
      }
      default:
        break
    }
  })

  const doc = create(xmlResult)
  const xml = doc.end({ prettyPrint: true })
  console.log('=-=-=-= FINISHED PARSE TO XML =-=-=-=')
  console.log(xml)
}
