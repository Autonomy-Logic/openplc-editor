import { BaseLibraryPouSchema, BaseLibrarySchema, BaseLibraryVariableSchema } from '@root/types/PLC/library'
import { z } from 'zod'

const NumericalVariableSchema = BaseLibraryVariableSchema

const NumericalPouSchema = BaseLibraryPouSchema.extend({
  variables: z.array(NumericalVariableSchema),
})

const NumericalLibrarySchema = BaseLibrarySchema.extend({
  pous: z.array(NumericalPouSchema),
})

type NumericalLibrary = z.infer<typeof NumericalLibrarySchema>

const Numerical: NumericalLibrary = {
  name: 'Numerical',
  version: '1.0.0',
  author: 'Autonomy Logic',
  stPath: 'path/to/st/file',
  cPath: 'path/to/c/file',
  pous: [
    {
      name: 'ABS',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'STRING' }, // Dont have a type for NUM
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' }, // Dont have a type for NUM
        },
      ],
      body: 'Absolute value',
      documentation: '(IN:ANY_NUM) -> OUT:ANY_NUM',
      extensible: false,
    },
    {
      name: 'SQRT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'REAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Square root (base 2)',
      documentation: '(IN:ANY_REAL) -> OUT:ANY_REAL',
      extensible: false,
    },
    {
      name: 'LN',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'REAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Arc tangent',
      documentation: '(IN:ANY_REAL) -> OUT:ANY_REAL',
      extensible: false,
    },
    {
      name: 'LOG',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'REAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Logarithm to base 10',
      documentation: '(IN:ANY_REAL) -> OUT:ANY_REAL',
      extensible: false,
    },
    {
      name: 'EXP',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'REAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Exponentiation',
      documentation: '(IN:ANY_REAL) -> OUT:ANY_REAL',
      extensible: false,
    },
    {
      name: 'SIN',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'REAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Sine',
      documentation: '(IN:ANY_REAL) -> OUT:ANY_REAL',
      extensible: false,
    },
    {
      name: 'COS',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'REAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Cosine',
      documentation: '(IN:ANY_REAL) -> OUT:ANY_REAL',
      extensible: false,
    },
    {
      name: 'TAN',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'REAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Tangent',
      documentation: '(IN:ANY_REAL) -> OUT:ANY_REAL',
      extensible: false,
    },
    {
      name: 'ASIN',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'REAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Arc sine',
      documentation: '(IN:ANY_REAL) -> OUT:ANY_REAL',
      extensible: false,
    },
    {
      name: 'ACOS',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'REAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Arc cosine',
      documentation: '(IN:ANY_REAL) -> OUT:ANY_REAL',
      extensible: false,
    },
    {
      name: 'ATAN',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'REAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Arc tangent',
      documentation: '(IN:ANY_REAL) -> OUT:ANY_REAL',
      extensible: false,
    },
  ],
}

export { Numerical }
