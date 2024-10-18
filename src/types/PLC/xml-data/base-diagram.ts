import { formatDate } from '@root/utils'
import { z } from 'zod'

import { pousSchema } from './pous/pous-diagram'
import { taskXMLSchema } from './task/task-diagram'
import { variableXMLSchema } from './variable/variable-diagram'

const baseXmlSchema = z.object({
  project: z.object({
    '@xmlns': z.string().default('http://www.plcopen.org/xml/tc6_0201'),
    '@xmlns:xsd': z.string().default('http://www.w3.org/2001/XMLSchema-instance'),
    '@xmlns:xhtml': z.string().default('http://www.w3.org/1999/xhtml'),
    '@xmlns:ns1': z.string().default('http://www.plcopen.org/xml/tc6.xsd'),
    '@xsi:schemaLocation': z
      .string()
      .default('http://www.plcopen.org/xml/tc6_0200 http://www.plcopen.org/xml/tc6_0200')
      .optional(),

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
      dataTypes: z.string(),
      pous: pousSchema,
    }),

    instances: z.object({
      configurations: z.object({
        configuration: z.object({
          '@name': z.string().default('Config0'),
          resource: z.object({
            '@name': z.string().default('Res0'),
            globalVars: z.array(variableXMLSchema),
            task: z.array(taskXMLSchema),
          }),
        }),
      }),
    }),
  }),
})
type BaseXml = z.infer<typeof baseXmlSchema>

export { baseXmlSchema }
export type { BaseXml }
