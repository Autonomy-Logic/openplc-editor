import { z } from 'zod'

import {
  PLCDataTypeSchema,
  PLCFunctionBlockSchema,
  PLCFunctionSchema,
  PLCInstanceSchema,
  PLCProgramSchema,
  PLCTaskSchema,
  PLCVariableSchema,
} from '../open-plc'

const PLCProjectDataSchema = z.object({
  'data-types': z.array(PLCDataTypeSchema),
  pous: z.array(
    z.discriminatedUnion('type', [
      z.object({
        type: z.literal('program'),
        data: PLCProgramSchema,
      }),
      z.object({
        type: z.literal('function'),
        data: PLCFunctionSchema,
      }),
      z.object({
        type: z.literal('function-block'),
        data: PLCFunctionBlockSchema,
      }),
    ]),
  ),
  configuration: z.object({
    resource: z.object({
      tasks: z.array(PLCTaskSchema),
      instances: z.array(PLCInstanceSchema),
      'global-variables': z.array(PLCVariableSchema.omit({ class: true })),
    }),
  }),
})

type PLCProjectData = z.infer<typeof PLCProjectDataSchema>

export { PLCProjectData, PLCProjectDataSchema }
