import { formatDate } from '../../../utils';

const xmlProjectAsObject = {
  project: {
    '@xmlns': 'http://www.plcopen.org/xml/tc6_0201',
    '@xmlns:ns1': 'http://www.plcopen.org/xml/tc6.xsd',
    '@xmlns:xhtml': 'http://www.w3.org/1999/xhtml',
    '@xmlns:xsd': 'http://www.w3.org/2001/XMLSchema-instance',
    '@xsi:schemaLocation':
      'http://www.plcopen.org/xml/tc6_0200 http://www.plcopen.org/xml/tc6_0200',
    fileHeader: {
      '@companyName': 'Unknown',
      '@creationDateTime': formatDate(new Date()),
      '@productName': 'Unnamed',
      '@productVersion': '1',
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
      dataTypes: {},
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
          },
        },
      },
    },
  },
};

export default xmlProjectAsObject;
