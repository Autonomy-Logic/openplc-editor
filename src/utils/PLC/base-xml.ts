import { IlXML } from '@root/types/PLC/xml-data'
import { BaseXml } from '@root/types/PLC/xml-data/base-diagram'
import { create } from 'xmlbuilder2'

import formatDate from '../formatDate'

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
    instances: {
      configurations: {
        configuration: {
          '@name': 'Config0',
          resource: {
            '@name': 'Res0',
          },
        },
      },
    },
  },
}

export const startParseXML = () => {
  const ilXML: IlXML = {
    'xhtml:p': {
      $: 'Hello World',
    },
  }
  const doc = create(ilXML)
  const xml = doc.end({ prettyPrint: true })
  console.log(xml)
}
