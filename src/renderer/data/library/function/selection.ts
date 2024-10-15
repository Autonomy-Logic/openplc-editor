import {
  BaseLibraryPouSchema,
  BaseLibrarySchema,
  BaseLibraryVariableSchema,
  baseTypeSchema,
  genericTypeSchema,
} from '@root/types/PLC'
import { z } from 'zod'

const SelectionVariableSchema = BaseLibraryVariableSchema.extend({
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

const SelectionPouSchema = BaseLibraryPouSchema.extend({
  variables: z.array(SelectionVariableSchema),
})

const SelectionLibrarySchema = BaseLibrarySchema.extend({
  pous: z.array(SelectionPouSchema),
})

type SelectionLibrary = z.infer<typeof SelectionLibrarySchema>

const Selection: SelectionLibrary = {
  name: 'Selection',
  version: '1.0.0',
  author: 'Autonomy Logic',
  stPath: 'path/to/st/file',
  cPath: 'path/to/c/file',
  pous: [
    {
      name: 'SEL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'G',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
        },
        {
          name: 'IN0',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY' },
        },
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'generic-type', value: 'ANY' },
        },
      ],
      body: 'Binary selection (1 of 2)',
      documentation: '(G:BOOL, IN0:ANY, IN1:ANY) => OUT:ANY',
      extensible: false,
    },
    {
      name: 'MAX',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'generic-type', value: 'ANY' },
        },
      ],
      body: 'Maximum',
      documentation: '(IN1:ANY, IN2:ANY) => OUT:ANY',
      extensible: true,
    },
    {
      name: 'MIN',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'generic-type', value: 'ANY' },
        },
      ],
      body: 'Minimum',
      documentation: '(IN1:ANY, IN2:ANY) => OUT:ANY',
      extensible: true,
    },
    {
      name: 'LIMIT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'MN',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY' },
        },
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY' },
        },
        {
          name: 'MX',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'generic-type', value: 'ANY' },
        },
      ],
      body: 'Limitation',
      documentation: '(MN:ANY, IN:ANY, MX:ANY) => OUT:ANY',
      extensible: false,
    },
    {
      name: 'MUX',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'K',
          class: 'input',
          type: { definition: 'base-type', value: 'INT' },
        },
        {
          name: 'IN0',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY' },
        },
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'generic-type', value: 'ANY' },
        },
      ],
      body: 'Multiplexer (select 1 of N)',
      documentation: '(K:INT, IN0:ANY, IN1:ANY) => OUT:ANY',
      extensible: true,
    },
  ],
}

export { Selection, SelectionLibrarySchema }
