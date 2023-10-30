import formatDate from '../../utils/formatDate';

const DefaultProjectShape = {
  project: {
    '@xmlns:ns1': 'http://www.plcopen.org/xml/tc6.xsd',
    '@xmlns:xhtml': 'http://www.w3.org/1999/xhtml',
    '@xmlns:xsd': 'http://www.w3.org/2001/XMLSchema',
    '@xmlns': 'http://www.plcopen.org/xml/tc6_0201',
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
      dataTypes: {},
      pous: {
        pou: [
          {
            '@name': 'program0',
            '@pouType': 'program',
            interface: {
              returnType: 'BOOL',
              localVars: {
                variable: {
                  '@name': 'LocalVar0',
                  type: 'INT',
                  initialValue: { simpleValue: { '@value': '0' } },
                },
              },
            },
            body: {
              IL: {
                'xhtml:p': '<![CDATA[]]>',
              },
            },
            documentation: {
              'xhtml:p': '<![CDATA[]]>',
            },
          },
        ],
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

export type ProjectDTO = typeof DefaultProjectShape;
