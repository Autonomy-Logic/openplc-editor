import {
  BaseLibraryPouSchema,
  BaseLibrarySchema,
  BaseLibraryVariableSchema,
  baseTypeSchema,
  genericTypeSchema,
} from '@root/types/PLC'
import { z } from 'zod'

const ArithmeticVariableSchema = BaseLibraryVariableSchema.extend({
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

const ArithmeticPouSchema = BaseLibraryPouSchema.extend({
  variables: z.array(ArithmeticVariableSchema),
})

const ArithmeticLibrarySchema = BaseLibrarySchema.extend({
  pous: z.array(ArithmeticPouSchema),
})

type ArithmeticLibrary = z.infer<typeof ArithmeticLibrarySchema>

const Arithmetic: ArithmeticLibrary = {
  name: 'Arithmetic',
  version: '1.0.0',
  author: 'Autonomy Logic',
  stPath: 'path/to/st/file',
  cPath: 'path/to/c/file',
  pous: [
    {
      name: 'ADD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_NUM' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_NUM' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'generic-type', value: 'ANY_NUM' },
        },
      ],
      body: 'Addition',
      documentation: '(IN1: ANY_NUM, IN2:ANY_NUM) => OUT:ANY_NUM',
      extensible: true,
    },
    {
      name: 'MUL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_NUM' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_NUM' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'generic-type', value: 'ANY_NUM' },
        },
      ],
      body: 'Multiplication',
      documentation: '(IN1: ANY_NUM, IN2:ANY_NUM) => OUT:ANY_NUM',
      extensible: true,
    },
    {
      name: 'SUB',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_NUM' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_NUM' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'generic-type', value: 'ANY_NUM' },
        },
      ],
      body: 'Subtraction',
      documentation: '(IN1: ANY_NUM, IN2:ANY_NUM) => OUT:ANY_NUM',
      extensible: false,
    },
    {
      name: 'DIV',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_NUM' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_NUM' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'generic-type', value: 'ANY_NUM' },
        },
      ],
      body: 'Division',
      documentation: '(IN1: ANY_NUM, IN2:ANY_NUM) => OUT:ANY_NUM',
      extensible: false,
    },
    {
      name: 'MOD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_INT' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_INT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'generic-type', value: 'ANY_INT' },
        },
      ],
      body: 'Remainder (modulo)',
      documentation: '(IN1: ANY_INT, IN2:ANY_INT) => OUT:ANY_INT',
      extensible: false,
    },
    {
      name: 'EXPT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_REAL' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_REAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'generic-type', value: 'ANY_REAL' },
        },
      ],
      body: 'Exponent',
      documentation: '(IN1: ANY_REAL, IN2:ANY_REAL) => OUT:ANY_REAL',
      extensible: false,
    },
    {
      name: 'MOVE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'generic-type', value: 'ANY' },
        },
      ],
      body: 'Assignment',
      documentation: '(IN: ANY, OUT:ANY) => OUT:ANY',
      extensible: false,
    },
  ],
}

export { Arithmetic, ArithmeticLibrarySchema }
