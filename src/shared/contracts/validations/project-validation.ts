import z from 'zod';

import { formatDate } from '../../../utils';

// eslint-disable-next-line import/prefer-default-export
export const ProjectSchema = z.object({
  project: z.object({
    '@xmlns': z.string().default('http://www.plcopen.org/xml/tc6_0201'),
    '@xmlns:ns1': z.string().default('http://www.plcopen.org/xml/tc6.xsd'),
    '@xmlns:xhtml': z.string().default('http://www.w3.org/1999/xhtml'),
    '@xmlns:xsi': z.string().default('http://www.w3.org/2001/XMLSchema'),
    '@xsi:schemaLocation': z
      .string()
      .default('http://www.plcopen.org/xml/tc6_0200 http://www.plcopen.org/xml/tc6_0200'),
    /**
     * Here we can add a comment in the xml file.
     * @example <!--Information about the creation of the file-->
     */
    fileHeader: z.object({
      '@companyName': z.string().default('Unknown'),
      '@creationDateTime': z.string().default(formatDate(new Date())),
      '@productName': z.string().default('Unnamed'),
      '@productVersion': z.string().default('1'),
    }),
    contentHeader: z.object({
      '@name': z.string().default('Unnamed'),
      '@modificationDateTime': z.string().default(formatDate(new Date())),
      /**
       * Here we can add a comment in the xml file.
       * @example <!--Basis for coordination systems-->
       */
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
        }),
        sfc: z.object({
          scaling: z.object({
            '@x': z.string().default('10'),
            '@y': z.string().default('10'),
          }),
        }),
      }),
    }),
    types: z.object({
      dataTypes: z.object({}),
      pous: z.object({
        pou: z.array(z.object({}).optional()),
      }),
    }),
    instances: z.object({
      configurations: z.object({
        configuration: z.object({
          '@name': z.string().default('Config0'),
          resource: z.object({
            '@name': z.string().default('Res0'),
          }),
        }),
      }),
    }),
  }),
});
