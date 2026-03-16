import { z } from 'zod'

import {
  BaseLibraryPouSchema,
  BaseLibraryVariableSchema,
  baseTypeSchema,
  genericTypeSchema,
} from '../../../../middleware/shared/ports/plc-schemas'

/** Library-level schema (name + version + paths). Not in plc-schemas so defined locally. */
const BaseLibrarySchema = z.object({
  name: z.string(),
  version: z.string(),
  author: z.string(),
  stPath: z.string(),
  cPath: z.string(),
})


const BitwiseVariableSchema = BaseLibraryVariableSchema.extend({
  type: z.discriminatedUnion('definition', [
    z.object({
      definition: z.literal('base-type'),
      value: baseTypeSchema,
    }),
    z.object({
      definition: z.literal('generic-type'),
      value: genericTypeSchema.keyof(),
    }),
  ]),
})

const BitwisePouSchema = BaseLibraryPouSchema.extend({
  variables: z.array(BitwiseVariableSchema),
})

const BitwiseLibrarySchema = BaseLibrarySchema.extend({
  pous: z.array(BitwisePouSchema),
})

type BitwiseLibrary = z.infer<typeof BitwiseLibrarySchema>

const Bitwise: BitwiseLibrary = {
  name: 'Bitwise',
  version: '1.0.0',
  author: 'Autonomy Logic',
  stPath: 'path/to/st/file',
  cPath: 'path/to/c/file',
  pous: [
    {
      name: 'AND',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_BIT' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_BIT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'generic-type', value: 'ANY_BIT' },
        },
      ],
      body: 'Bitwise AND',
      documentation: '(IN1: ANY_BIT, IN2:ANY_BIT) => OUT:ANY_BIT',
      extensible: true,
    },
    {
      name: 'OR',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_BIT' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_BIT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'generic-type', value: 'ANY_BIT' },
        },
      ],
      body: 'Bitwise OR',
      documentation: '(IN1: ANY_BIT, IN2:ANY_BIT) => OUT:ANY_BIT',
      extensible: true,
    },
    {
      name: 'XOR',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_BIT' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_BIT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'generic-type', value: 'ANY_BIT' },
        },
      ],
      body: 'Bitwise XOR',
      documentation: '(IN1: ANY_BIT, IN2:ANY_BIT) => OUT:ANY_BIT',
      extensible: true,
    },
    {
      name: 'NOT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_BIT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'generic-type', value: 'ANY_BIT' },
        },
      ],
      body: 'Bitwise NOT',
      documentation: '(IN: ANY_BIT) => OUT:ANY_BIT',
      extensible: false,
    },
  ],
}

export { Bitwise, BitwiseLibrarySchema }
