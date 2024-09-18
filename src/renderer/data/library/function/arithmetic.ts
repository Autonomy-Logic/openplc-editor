import { BaseLibraryPouSchema, BaseLibrarySchema, BaseLibraryVariableSchema } from '@root/types/PLC/library'
import { z } from 'zod'

const ArithmeticVariableSchema = BaseLibraryVariableSchema

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
          type: { definition: 'base-type', value: 'REAL' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'base-type', value: 'REAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Addition',
      documentation: '(IN1: ANY_NUM, IN2:ANY_NUM) -> OUT:ANY_NUM',
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
          type: { definition: 'base-type', value: 'REAL' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'base-type', value: 'REAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Multiplication',
      documentation: '(IN1: ANY_NUM, IN2:ANY_NUM) -> OUT:ANY_NUM',
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
          type: { definition: 'base-type', value: 'REAL' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'base-type', value: 'REAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Subtraction',
      documentation: '(IN1: ANY_NUM, IN2:ANY_NUM) -> OUT:ANY_NUM',
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
          type: { definition: 'base-type', value: 'REAL' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'base-type', value: 'REAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Division',
      documentation: '(IN1: ANY_NUM, IN2:ANY_NUM) -> OUT:ANY_NUM',
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
          type: { definition: 'base-type', value: 'INT' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'base-type', value: 'INT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'INT' },
        },
      ],
      body: 'Remainder (modulo)',
      documentation: '(IN1: ANY_INT, IN2:ANY_INT) -> OUT:ANY_INT',
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
          type: { definition: 'base-type', value: 'REAL' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'base-type', value: 'REAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Exponent',
      documentation: '(IN1: ANY_REAL, IN2:ANY_REAL) -> OUT:ANY_REAL',
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
          type: { definition: 'base-type', value: 'STRING' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' },
        },
      ],
      body: 'Assignment',
      documentation: '(IN: ANY, OUT:ANY) -> OUT:ANY',
      extensible: false,
    },
  ],
}

export { Arithmetic }
