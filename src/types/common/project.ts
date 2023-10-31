import { z } from 'zod';
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

const ProjectXMLShape = z.object({
  project: z.object({
    '@xmlns:ns1': z.string().default('http://www.plcopen.org/xml/tc6.xsd'),
    '@xmlns:xhtml': z.string().default('http://www.w3.org/1999/xhtml'),
    '@xmlns:xsd': z.string().default('http://www.w3.org/2001/XMLSchema'),
    '@xmlns': z.string().default('http://www.plcopen.org/xml/tc6_0201'),
    fileHeader: z.object({
      '@companyName': z.string().default('Unknown'),
      '@productName': z.string().default('Unnamed'),
      '@productVersion': z.string().default('1'),
      '@creationDateTime': z.string().default(formatDate(new Date())),
    }),
    contentHeader: z.object({
      '@name': z.string().default('Unnamed'),
      '@modificationDateTime': z.string().default(formatDate(new Date())),
      coordinateInfo: z.object({
        fbd: z.object({
          scaling: z.object({
            '@x': z.string().default('10'),
            '@y': z.string().default('10'),
          }),
        }),
        ld: z.object({
          scaling: z.object({
            '@x': z.string().default('10'),
            '@y': z.string().default('10'),
          }),
          sfd: z.object({
            scaling: z.object({
              '@x': z.string().default('10'),
              '@y': z.string().default('10'),
            }),
          }),
        }),
      }),
    }),
    types: z.object({
      dataTypes: z.object({
        dataType: z.array(z.object({})).optional(),
      }),
      pous: z.object({
        pou: z.array(z.object({})).optional(),
      }),
    }),
    instances: z.object({
      configurations: z.object({
        configuration: z.object({
          '@name': z.string().default('Config0'),
          resource: z.object({
            '@name': z.string(),
          }),
        }),
      }),
    }),
  }),
});
