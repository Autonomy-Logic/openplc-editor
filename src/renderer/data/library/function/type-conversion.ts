import {
  BaseLibraryPouSchema,
  BaseLibrarySchema,
  BaseLibraryVariableSchema,
  baseTypeSchema,
  genericTypeSchema,
} from '@root/types/PLC/library'
import { z } from 'zod'

const TypeConversionVariableSchema = BaseLibraryVariableSchema.extend({
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

const TypeConversionPouSchema = BaseLibraryPouSchema.extend({
  variables: z.array(TypeConversionVariableSchema),
})

const TypeConversionLibrarySchema = BaseLibrarySchema.extend({
  pous: z.array(TypeConversionPouSchema),
})

type TypeConversionLibrary = z.infer<typeof TypeConversionLibrarySchema>

const TypeConversion: TypeConversionLibrary = {
  name: 'TypeConversion',
  version: '1.0.0',
  author: 'Autonomy Logic',
  stPath: 'path/to/st/file',
  cPath: 'path/to/c/file',
  pous: [
    {
      name: 'BOOL_TO_SINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'SINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BOOL) => OUT: SINT',
      extensible: false,
    },
    {
      name: 'BOOL_TO_INT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'INT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BOOL) => OUT: INT',
      extensible: false,
    },
    {
      name: 'BOOL_TO_DINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BOOL) => OUT: DINT',
      extensible: false,
    },
    {
      name: 'BOOL_TO_LINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BOOL) => OUT: LINT',
      extensible: false,
    },
    {
      name: 'BOOL_TO_USINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'USINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BOOL) => OUT: USINT',
      extensible: false,
    },
    {
      name: 'BOOL_TO_UINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BOOL) => OUT: UINT',
      extensible: false,
    },
    {
      name: 'BOOL_TO_UDINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UDINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BOOL) => OUT: UDINT',
      extensible: false,
    },
    {
      name: 'BOOL_TO_ULINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'ULINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BOOL) => OUT: ULINT',
      extensible: false,
    },
    {
      name: 'BOOL_TO_REAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BOOL) => OUT: REAL',
      extensible: false,
    },
    {
      name: 'BOOL_TO_LREAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LREAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BOOL) => OUT: LREAL',
      extensible: false,
    },
    {
      name: 'BOOL_TO_TIME',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TIME' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BOOL) => OUT: TIME',
      extensible: false,
    },
    {
      name: 'BOOL_TO_DATE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DATE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BOOL) => OUT: DATE',
      extensible: false,
    },
    {
      name: 'BOOL_TO_TOD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TOD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BOOL) => OUT: TOD',
      extensible: false,
    },
    {
      name: 'BOOL_TO_DT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BOOL) => OUT: DT',
      extensible: false,
    },
    {
      name: 'BOOL_TO_STRING',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BOOL) => OUT: STRING',
      extensible: false,
    },
    {
      name: 'BOOL_TO_BYTE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BYTE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BOOL) => OUT: BYTE',
      extensible: false,
    },
    {
      name: 'BOOL_TO_WORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'WORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BOOL) => OUT: WORD',
      extensible: false,
    },
    {
      name: 'BOOL_TO_DWORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BOOL) => OUT: DWORD',
      extensible: false,
    },
    {
      name: 'BOOL_TO_LWORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BOOL) => OUT: LWORD',
      extensible: false,
    },
    {
      name: 'SINT_TO_BOOL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'SINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: SINT) => OUT: BOOL',
      extensible: false,
    },
    {
      name: 'SINT_TO_INT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'SINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'INT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: SINT) => OUT: INT',
      extensible: false,
    },
    {
      name: 'SINT_TO_DINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'SINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: SINT) => OUT: DINT',
      extensible: false,
    },
    {
      name: 'SINT_TO_LINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'SINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: SINT) => OUT: LINT',
      extensible: false,
    },
    {
      name: 'SINT_TO_USINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'SINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'USINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: SINT) => OUT: USINT',
      extensible: false,
    },
    {
      name: 'SINT_TO_UINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'SINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: SINT) => OUT: UINT',
      extensible: false,
    },
    {
      name: 'SINT_TO_UDINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'SINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UDINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: SINT) => OUT: UDINT',
      extensible: false,
    },
    {
      name: 'SINT_TO_ULINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'SINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'ULINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: SINT) => OUT: ULINT',
      extensible: false,
    },
    {
      name: 'SINT_TO_REAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'SINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: SINT) => OUT: REAL',
      extensible: false,
    },
    {
      name: 'SINT_TO_LREAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'SINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LREAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: SINT) => OUT: LREAL',
      extensible: false,
    },
    {
      name: 'SINT_TO_TIME',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'SINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TIME' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: SINT) => OUT: TIME',
      extensible: false,
    },
    {
      name: 'SINT_TO_DATE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'SINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DATE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: SINT) => OUT: DATE',
      extensible: false,
    },
    {
      name: 'SINT_TO_TOD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'SINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TOD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: SINT) => OUT: TOD',
      extensible: false,
    },
    {
      name: 'SINT_TO_DT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'SINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: SINT) => OUT: DT',
      extensible: false,
    },
    {
      name: 'SINT_TO_STRING',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'SINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: SINT) => OUT: STRING',
      extensible: false,
    },
    {
      name: 'SINT_TO_BYTE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'SINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BYTE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: SINT) => OUT: BYTE',
      extensible: false,
    },
    {
      name: 'SINT_TO_WORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'SINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'WORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: SINT) => OUT: WORD',
      extensible: false,
    },
    {
      name: 'SINT_TO_DWORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'SINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: SINT) => OUT: DWORD',
      extensible: false,
    },
    {
      name: 'SINT_TO_LWORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'SINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: SINT) => OUT: LWORD',
      extensible: false,
    },
    {
      name: 'INT_TO_BOOL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'INT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: INT) => OUT: BOOL',
      extensible: false,
    },
    {
      name: 'INT_TO_SINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'INT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'SINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: INT) => OUT: SINT',
      extensible: false,
    },
    {
      name: 'INT_TO_DINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'INT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: INT) => OUT: DINT',
      extensible: false,
    },
    {
      name: 'INT_TO_LINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'INT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: INT) => OUT: LINT',
      extensible: false,
    },
    {
      name: 'INT_TO_USINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'INT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'USINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: INT) => OUT: USINT',
      extensible: false,
    },
    {
      name: 'INT_TO_UINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'INT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: INT) => OUT: UINT',
      extensible: false,
    },
    {
      name: 'INT_TO_UDINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'INT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UDINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: INT) => OUT: UDINT',
      extensible: false,
    },
    {
      name: 'INT_TO_ULINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'INT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'ULINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: INT) => OUT: ULINT',
      extensible: false,
    },
    {
      name: 'INT_TO_REAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'INT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: INT) => OUT: REAL',
      extensible: false,
    },
    {
      name: 'INT_TO_LREAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'INT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LREAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: INT) => OUT: LREAL',
      extensible: false,
    },
    {
      name: 'INT_TO_TIME',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'INT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TIME' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: INT) => OUT: TIME',
      extensible: false,
    },
    {
      name: 'INT_TO_DATE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'INT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DATE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: INT) => OUT: DATE',
      extensible: false,
    },
    {
      name: 'INT_TO_TOD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'INT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TOD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: INT) => OUT: TOD',
      extensible: false,
    },
    {
      name: 'INT_TO_DT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'INT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: INT) => OUT: DT',
      extensible: false,
    },
    {
      name: 'INT_TO_STRING',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'INT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: INT) => OUT: STRING',
      extensible: false,
    },
    {
      name: 'INT_TO_BYTE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'INT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BYTE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: INT) => OUT: BYTE',
      extensible: false,
    },
    {
      name: 'INT_TO_WORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'INT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'WORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: INT) => OUT: WORD',
      extensible: false,
    },
    {
      name: 'INT_TO_DWORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'INT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: INT) => OUT: DWORD',
      extensible: false,
    },
    {
      name: 'INT_TO_LWORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'INT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: INT) => OUT: LWORD',
      extensible: false,
    },
    {
      name: 'DINT_TO_BOOL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DINT) => OUT: BOOL',
      extensible: false,
    },
    {
      name: 'DINT_TO_SINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'SINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DINT) => OUT: SINT',
      extensible: false,
    },
    {
      name: 'DINT_TO_INT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'INT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DINT) => OUT: INT',
      extensible: false,
    },
    {
      name: 'DINT_TO_LINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DINT) => OUT: LINT',
      extensible: false,
    },
    {
      name: 'DINT_TO_USINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'USINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DINT) => OUT: USINT',
      extensible: false,
    },
    {
      name: 'DINT_TO_UINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DINT) => OUT: UINT',
      extensible: false,
    },
    {
      name: 'DINT_TO_UDINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UDINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DINT) => OUT: UDINT',
      extensible: false,
    },
    {
      name: 'DINT_TO_ULINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'ULINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DINT) => OUT: ULINT',
      extensible: false,
    },
    {
      name: 'DINT_TO_REAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DINT) => OUT: REAL',
      extensible: false,
    },
    {
      name: 'DINT_TO_LREAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LREAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DINT) => OUT: LREAL',
      extensible: false,
    },
    {
      name: 'DINT_TO_TIME',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TIME' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DINT) => OUT: TIME',
      extensible: false,
    },
    {
      name: 'DINT_TO_DATE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DATE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DINT) => OUT: DATE',
      extensible: false,
    },
    {
      name: 'DINT_TO_TOD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TOD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DINT) => OUT: TOD',
      extensible: false,
    },
    {
      name: 'DINT_TO_DT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DINT) => OUT: DT',
      extensible: false,
    },
    {
      name: 'DINT_TO_STRING',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DINT) => OUT: STRING',
      extensible: false,
    },
    {
      name: 'DINT_TO_BYTE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BYTE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DINT) => OUT: BYTE',
      extensible: false,
    },
    {
      name: 'DINT_TO_WORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'WORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DINT) => OUT: WORD',
      extensible: false,
    },
    {
      name: 'DINT_TO_DWORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DINT) => OUT: DWORD',
      extensible: false,
    },
    {
      name: 'DINT_TO_LWORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DINT) => OUT: LWORD',
      extensible: false,
    },
    {
      name: 'LINT_TO_BOOL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LINT) => OUT: BOOL',
      extensible: false,
    },
    {
      name: 'LINT_TO_SINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'SINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LINT) => OUT: SINT',
      extensible: false,
    },
    {
      name: 'LINT_TO_INT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'INT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LINT) => OUT: INT',
      extensible: false,
    },
    {
      name: 'LINT_TO_DINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LINT) => OUT: DINT',
      extensible: false,
    },
    {
      name: 'LINT_TO_USINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'USINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LINT) => OUT: USINT',
      extensible: false,
    },
    {
      name: 'LINT_TO_UINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LINT) => OUT: UINT',
      extensible: false,
    },
    {
      name: 'LINT_TO_UDINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UDINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LINT) => OUT: UDINT',
      extensible: false,
    },
    {
      name: 'LINT_TO_ULINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'ULINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LINT) => OUT: ULINT',
      extensible: false,
    },
    {
      name: 'LINT_TO_REAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LINT) => OUT: REAL',
      extensible: false,
    },
    {
      name: 'LINT_TO_LREAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LREAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LINT) => OUT: LREAL',
      extensible: false,
    },
    {
      name: 'LINT_TO_TIME',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TIME' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LINT) => OUT: TIME',
      extensible: false,
    },
    {
      name: 'LINT_TO_DATE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DATE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LINT) => OUT: DATE',
      extensible: false,
    },
    {
      name: 'LINT_TO_TOD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TOD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LINT) => OUT: TOD',
      extensible: false,
    },
    {
      name: 'LINT_TO_DT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LINT) => OUT: DT',
      extensible: false,
    },
    {
      name: 'LINT_TO_STRING',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LINT) => OUT: STRING',
      extensible: false,
    },
    {
      name: 'LINT_TO_BYTE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BYTE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LINT) => OUT: BYTE',
      extensible: false,
    },
    {
      name: 'LINT_TO_WORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'WORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LINT) => OUT: WORD',
      extensible: false,
    },
    {
      name: 'LINT_TO_DWORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LINT) => OUT: DWORD',
      extensible: false,
    },
    {
      name: 'LINT_TO_LWORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LINT) => OUT: LWORD',
      extensible: false,
    },
    {
      name: 'USINT_TO_BOOL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'USINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: USINT) => OUT: BOOL',
      extensible: false,
    },
    {
      name: 'USINT_TO_SINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'USINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'SINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: USINT) => OUT: SINT',
      extensible: false,
    },
    {
      name: 'USINT_TO_INT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'USINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'INT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: USINT) => OUT: INT',
      extensible: false,
    },
    {
      name: 'USINT_TO_DINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'USINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: USINT) => OUT: DINT',
      extensible: false,
    },
    {
      name: 'USINT_TO_LINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'USINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: USINT) => OUT: LINT',
      extensible: false,
    },
    {
      name: 'USINT_TO_UINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'USINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: USINT) => OUT: UINT',
      extensible: false,
    },
    {
      name: 'USINT_TO_UDINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'USINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UDINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: USINT) => OUT: UDINT',
      extensible: false,
    },
    {
      name: 'USINT_TO_ULINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'USINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'ULINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: USINT) => OUT: ULINT',
      extensible: false,
    },
    {
      name: 'USINT_TO_REAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'USINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: USINT) => OUT: REAL',
      extensible: false,
    },
    {
      name: 'USINT_TO_LREAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'USINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LREAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: USINT) => OUT: LREAL',
      extensible: false,
    },
    {
      name: 'USINT_TO_TIME',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'USINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TIME' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: USINT) => OUT: TIME',
      extensible: false,
    },
    {
      name: 'USINT_TO_DATE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'USINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DATE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: USINT) => OUT: DATE',
      extensible: false,
    },
    {
      name: 'USINT_TO_TOD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'USINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TOD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: USINT) => OUT: TOD',
      extensible: false,
    },
    {
      name: 'USINT_TO_DT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'USINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: USINT) => OUT: DT',
      extensible: false,
    },
    {
      name: 'USINT_TO_STRING',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'USINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: USINT) => OUT: STRING',
      extensible: false,
    },
    {
      name: 'USINT_TO_BYTE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'USINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BYTE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: USINT) => OUT: BYTE',
      extensible: false,
    },
    {
      name: 'USINT_TO_WORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'USINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'WORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: USINT) => OUT: WORD',
      extensible: false,
    },
    {
      name: 'USINT_TO_DWORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'USINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: USINT) => OUT: DWORD',
      extensible: false,
    },
    {
      name: 'USINT_TO_LWORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'USINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: USINT) => OUT: LWORD',
      extensible: false,
    },
    {
      name: 'UINT_TO_BOOL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UINT) => OUT: BOOL',
      extensible: false,
    },
    {
      name: 'UINT_TO_SINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'SINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UINT) => OUT: SINT',
      extensible: false,
    },
    {
      name: 'UINT_TO_INT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'INT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UINT) => OUT: INT',
      extensible: false,
    },
    {
      name: 'UINT_TO_DINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UINT) => OUT: DINT',
      extensible: false,
    },
    {
      name: 'UINT_TO_LINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UINT) => OUT: LINT',
      extensible: false,
    },
    {
      name: 'UINT_TO_USINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'USINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UINT) => OUT: USINT',
      extensible: false,
    },
    {
      name: 'UINT_TO_UDINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UDINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UINT) => OUT: UDINT',
      extensible: false,
    },
    {
      name: 'UINT_TO_ULINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'ULINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UINT) => OUT: ULINT',
      extensible: false,
    },
    {
      name: 'UINT_TO_REAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UINT) => OUT: REAL',
      extensible: false,
    },
    {
      name: 'UINT_TO_LREAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LREAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UINT) => OUT: LREAL',
      extensible: false,
    },
    {
      name: 'UINT_TO_TIME',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TIME' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UINT) => OUT: TIME',
      extensible: false,
    },
    {
      name: 'UINT_TO_DATE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DATE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UINT) => OUT: DATE',
      extensible: false,
    },
    {
      name: 'UINT_TO_TOD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TOD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UINT) => OUT: TOD',
      extensible: false,
    },
    {
      name: 'UINT_TO_DT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UINT) => OUT: DT',
      extensible: false,
    },
    {
      name: 'UINT_TO_STRING',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UINT) => OUT: STRING',
      extensible: false,
    },
    {
      name: 'UINT_TO_BYTE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BYTE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UINT) => OUT: BYTE',
      extensible: false,
    },
    {
      name: 'UINT_TO_WORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'WORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UINT) => OUT: WORD',
      extensible: false,
    },
    {
      name: 'UINT_TO_DWORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UINT) => OUT: DWORD',
      extensible: false,
    },
    {
      name: 'UINT_TO_LWORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UINT) => OUT: LWORD',
      extensible: false,
    },
    {
      name: 'UDINT_TO_BOOL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UDINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UDINT) => OUT: BOOL',
      extensible: false,
    },
    {
      name: 'UDINT_TO_SINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UDINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'SINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UDINT) => OUT: SINT',
      extensible: false,
    },
    {
      name: 'UDINT_TO_INT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UDINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'INT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UDINT) => OUT: INT',
      extensible: false,
    },
    {
      name: 'UDINT_TO_DINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UDINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UDINT) => OUT: DINT',
      extensible: false,
    },
    {
      name: 'UDINT_TO_LINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UDINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UDINT) => OUT: LINT',
      extensible: false,
    },
    {
      name: 'UDINT_TO_USINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UDINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'USINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UDINT) => OUT: USINT',
      extensible: false,
    },
    {
      name: 'UDINT_TO_UINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UDINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UDINT) => OUT: UINT',
      extensible: false,
    },
    {
      name: 'UDINT_TO_ULINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UDINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'ULINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UDINT) => OUT: ULINT',
      extensible: false,
    },
    {
      name: 'UDINT_TO_REAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UDINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UDINT) => OUT: REAL',
      extensible: false,
    },
    {
      name: 'UDINT_TO_LREAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UDINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LREAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UDINT) => OUT: LREAL',
      extensible: false,
    },
    {
      name: 'UDINT_TO_TIME',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UDINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TIME' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UDINT) => OUT: TIME',
      extensible: false,
    },
    {
      name: 'UDINT_TO_DATE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UDINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DATE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UDINT) => OUT: DATE',
      extensible: false,
    },
    {
      name: 'UDINT_TO_TOD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UDINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TOD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UDINT) => OUT: TOD',
      extensible: false,
    },
    {
      name: 'UDINT_TO_DT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UDINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UDINT) => OUT: DT',
      extensible: false,
    },
    {
      name: 'UDINT_TO_STRING',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UDINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UDINT) => OUT: STRING',
      extensible: false,
    },
    {
      name: 'UDINT_TO_BYTE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UDINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BYTE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UDINT) => OUT: BYTE',
      extensible: false,
    },
    {
      name: 'UDINT_TO_WORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UDINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'WORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UDINT) => OUT: WORD',
      extensible: false,
    },
    {
      name: 'UDINT_TO_DWORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UDINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UDINT) => OUT: DWORD',
      extensible: false,
    },
    {
      name: 'UDINT_TO_LWORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UDINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: UDINT) => OUT: LWORD',
      extensible: false,
    },
    {
      name: 'ULINT_TO_BOOL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'ULINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: ULINT) => OUT: BOOL',
      extensible: false,
    },
    {
      name: 'ULINT_TO_SINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'ULINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'SINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: ULINT) => OUT: SINT',
      extensible: false,
    },
    {
      name: 'ULINT_TO_INT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'ULINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'INT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: ULINT) => OUT: INT',
      extensible: false,
    },
    {
      name: 'ULINT_TO_DINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'ULINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: ULINT) => OUT: DINT',
      extensible: false,
    },
    {
      name: 'ULINT_TO_LINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'ULINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: ULINT) => OUT: LINT',
      extensible: false,
    },
    {
      name: 'ULINT_TO_USINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'ULINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'USINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: ULINT) => OUT: USINT',
      extensible: false,
    },
    {
      name: 'ULINT_TO_UINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'ULINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: ULINT) => OUT: UINT',
      extensible: false,
    },
    {
      name: 'ULINT_TO_UDINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'ULINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UDINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: ULINT) => OUT: UDINT',
      extensible: false,
    },
    {
      name: 'ULINT_TO_REAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'ULINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: ULINT) => OUT: REAL',
      extensible: false,
    },
    {
      name: 'ULINT_TO_LREAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'ULINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LREAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: ULINT) => OUT: LREAL',
      extensible: false,
    },
    {
      name: 'ULINT_TO_TIME',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'ULINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TIME' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: ULINT) => OUT: TIME',
      extensible: false,
    },
    {
      name: 'ULINT_TO_DATE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'ULINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DATE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: ULINT) => OUT: DATE',
      extensible: false,
    },
    {
      name: 'ULINT_TO_TOD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'ULINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TOD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: ULINT) => OUT: TOD',
      extensible: false,
    },
    {
      name: 'ULINT_TO_DT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'ULINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: ULINT) => OUT: DT',
      extensible: false,
    },
    {
      name: 'ULINT_TO_STRING',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'ULINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: ULINT) => OUT: STRING',
      extensible: false,
    },
    {
      name: 'ULINT_TO_BYTE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'ULINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BYTE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: ULINT) => OUT: BYTE',
      extensible: false,
    },
    {
      name: 'ULINT_TO_WORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'ULINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'WORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: ULINT) => OUT: WORD',
      extensible: false,
    },
    {
      name: 'ULINT_TO_DWORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'ULINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: ULINT) => OUT: DWORD',
      extensible: false,
    },
    {
      name: 'ULINT_TO_LWORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'ULINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: ULINT) => OUT: LWORD',
      extensible: false,
    },
    {
      name: 'REAL_TO_BOOL',
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
          type: { definition: 'base-type', value: 'BOOL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: REAL) => OUT: BOOL',
      extensible: false,
    },
    {
      name: 'REAL_TO_SINT',
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
          type: { definition: 'base-type', value: 'SINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: REAL) => OUT: SINT',
      extensible: false,
    },
    {
      name: 'REAL_TO_INT',
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
          type: { definition: 'base-type', value: 'INT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: REAL) => OUT: INT',
      extensible: false,
    },
    {
      name: 'REAL_TO_DINT',
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
          type: { definition: 'base-type', value: 'DINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: REAL) => OUT: DINT',
      extensible: false,
    },
    {
      name: 'REAL_TO_LINT',
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
          type: { definition: 'base-type', value: 'LINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: REAL) => OUT: LINT',
      extensible: false,
    },
    {
      name: 'REAL_TO_USINT',
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
          type: { definition: 'base-type', value: 'USINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: REAL) => OUT: USINT',
      extensible: false,
    },
    {
      name: 'REAL_TO_UINT',
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
          type: { definition: 'base-type', value: 'UINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: REAL) => OUT: UINT',
      extensible: false,
    },
    {
      name: 'REAL_TO_UDINT',
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
          type: { definition: 'base-type', value: 'UDINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: REAL) => OUT: UDINT',
      extensible: false,
    },
    {
      name: 'REAL_TO_ULINT',
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
          type: { definition: 'base-type', value: 'ULINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: REAL) => OUT: ULINT',
      extensible: false,
    },
    {
      name: 'REAL_TO_LREAL',
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
          type: { definition: 'base-type', value: 'LREAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: REAL) => OUT: LREAL',
      extensible: false,
    },
    {
      name: 'REAL_TO_TIME',
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
          type: { definition: 'base-type', value: 'TIME' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: REAL) => OUT: TIME',
      extensible: false,
    },
    {
      name: 'REAL_TO_DATE',
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
          type: { definition: 'base-type', value: 'DATE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: REAL) => OUT: DATE',
      extensible: false,
    },
    {
      name: 'REAL_TO_TOD',
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
          type: { definition: 'base-type', value: 'TOD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: REAL) => OUT: TOD',
      extensible: false,
    },
    {
      name: 'REAL_TO_DT',
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
          type: { definition: 'base-type', value: 'DT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: REAL) => OUT: DT',
      extensible: false,
    },
    {
      name: 'REAL_TO_STRING',
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
          type: { definition: 'base-type', value: 'STRING' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: REAL) => OUT: STRING',
      extensible: false,
    },
    {
      name: 'REAL_TO_BYTE',
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
          type: { definition: 'base-type', value: 'BYTE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: REAL) => OUT: BYTE',
      extensible: false,
    },
    {
      name: 'REAL_TO_WORD',
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
          type: { definition: 'base-type', value: 'WORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: REAL) => OUT: WORD',
      extensible: false,
    },
    {
      name: 'REAL_TO_DWORD',
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
          type: { definition: 'base-type', value: 'DWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: REAL) => OUT: DWORD',
      extensible: false,
    },
    {
      name: 'REAL_TO_LWORD',
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
          type: { definition: 'base-type', value: 'LWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: REAL) => OUT: LWORD',
      extensible: false,
    },
    {
      name: 'LREAL_TO_BOOL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LREAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LREAL) => OUT: BOOL',
      extensible: false,
    },
    {
      name: 'LREAL_TO_SINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LREAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'SINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LREAL) => OUT: SINT',
      extensible: false,
    },
    {
      name: 'LREAL_TO_INT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LREAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'INT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LREAL) => OUT: INT',
      extensible: false,
    },
    {
      name: 'LREAL_TO_DINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LREAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LREAL) => OUT: DINT',
      extensible: false,
    },
    {
      name: 'LREAL_TO_LINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LREAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LREAL) => OUT: LINT',
      extensible: false,
    },
    {
      name: 'LREAL_TO_USINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LREAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'USINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LREAL) => OUT: USINT',
      extensible: false,
    },
    {
      name: 'LREAL_TO_UINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LREAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LREAL) => OUT: UINT',
      extensible: false,
    },
    {
      name: 'LREAL_TO_UDINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LREAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UDINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LREAL) => OUT: UDINT',
      extensible: false,
    },
    {
      name: 'LREAL_TO_ULINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LREAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'ULINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LREAL) => OUT: ULINT',
      extensible: false,
    },
    {
      name: 'LREAL_TO_REAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LREAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LREAL) => OUT: REAL',
      extensible: false,
    },
    {
      name: 'LREAL_TO_TIME',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LREAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TIME' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LREAL) => OUT: TIME',
      extensible: false,
    },
    {
      name: 'LREAL_TO_DATE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LREAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DATE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LREAL) => OUT: DATE',
      extensible: false,
    },
    {
      name: 'LREAL_TO_TOD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LREAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TOD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LREAL) => OUT: TOD',
      extensible: false,
    },
    {
      name: 'LREAL_TO_DT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LREAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LREAL) => OUT: DT',
      extensible: false,
    },
    {
      name: 'LREAL_TO_STRING',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LREAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LREAL) => OUT: STRING',
      extensible: false,
    },
    {
      name: 'LREAL_TO_BYTE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LREAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BYTE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LREAL) => OUT: BYTE',
      extensible: false,
    },
    {
      name: 'LREAL_TO_WORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LREAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'WORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LREAL) => OUT: WORD',
      extensible: false,
    },
    {
      name: 'LREAL_TO_DWORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LREAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LREAL) => OUT: DWORD',
      extensible: false,
    },
    {
      name: 'LREAL_TO_LWORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LREAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LREAL) => OUT: LWORD',
      extensible: false,
    },
    {
      name: 'TIME_TO_BOOL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TIME) => OUT: BOOL',
      extensible: false,
    },
    {
      name: 'TIME_TO_SINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'SINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TIME) => OUT: SINT',
      extensible: false,
    },
    {
      name: 'TIME_TO_INT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'INT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TIME) => OUT: INT',
      extensible: false,
    },
    {
      name: 'TIME_TO_DINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TIME) => OUT: DINT',
      extensible: false,
    },
    {
      name: 'TIME_TO_LINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TIME) => OUT: LINT',
      extensible: false,
    },
    {
      name: 'TIME_TO_USINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'USINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TIME) => OUT: USINT',
      extensible: false,
    },
    {
      name: 'TIME_TO_UINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TIME) => OUT: UINT',
      extensible: false,
    },
    {
      name: 'TIME_TO_UDINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UDINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TIME) => OUT: UDINT',
      extensible: false,
    },
    {
      name: 'TIME_TO_ULINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'ULINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TIME) => OUT: ULINT',
      extensible: false,
    },
    {
      name: 'TIME_TO_REAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TIME) => OUT: REAL',
      extensible: false,
    },
    {
      name: 'TIME_TO_LREAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LREAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TIME) => OUT: LREAL',
      extensible: false,
    },
    {
      name: 'TIME_TO_DATE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DATE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TIME) => OUT: DATE',
      extensible: false,
    },
    {
      name: 'TIME_TO_TOD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TOD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TIME) => OUT: TOD',
      extensible: false,
    },
    {
      name: 'TIME_TO_DT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TIME) => OUT: DT',
      extensible: false,
    },
    {
      name: 'TIME_TO_STRING',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TIME) => OUT: STRING',
      extensible: false,
    },
    {
      name: 'TIME_TO_BYTE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BYTE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TIME) => OUT: BYTE',
      extensible: false,
    },
    {
      name: 'TIME_TO_WORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'WORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TIME) => OUT: WORD',
      extensible: false,
    },
    {
      name: 'TIME_TO_DWORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TIME) => OUT: DWORD',
      extensible: false,
    },
    {
      name: 'TIME_TO_LWORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TIME) => OUT: LWORD',
      extensible: false,
    },
    {
      name: 'DATE_TO_BOOL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DATE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DATE) => OUT: BOOL',
      extensible: false,
    },
    {
      name: 'DATE_TO_SINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DATE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'SINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DATE) => OUT: SINT',
      extensible: false,
    },
    {
      name: 'DATE_TO_INT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DATE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'INT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DATE) => OUT: INT',
      extensible: false,
    },
    {
      name: 'DATE_TO_DINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DATE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DATE) => OUT: DINT',
      extensible: false,
    },
    {
      name: 'DATE_TO_LINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DATE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DATE) => OUT: LINT',
      extensible: false,
    },
    {
      name: 'DATE_TO_USINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DATE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'USINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DATE) => OUT: USINT',
      extensible: false,
    },
    {
      name: 'DATE_TO_UINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DATE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DATE) => OUT: UINT',
      extensible: false,
    },
    {
      name: 'DATE_TO_UDINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DATE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UDINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DATE) => OUT: UDINT',
      extensible: false,
    },
    {
      name: 'DATE_TO_ULINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DATE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'ULINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DATE) => OUT: ULINT',
      extensible: false,
    },
    {
      name: 'DATE_TO_REAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DATE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DATE) => OUT: REAL',
      extensible: false,
    },
    {
      name: 'DATE_TO_LREAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DATE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LREAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DATE) => OUT: LREAL',
      extensible: false,
    },
    {
      name: 'DATE_TO_TIME',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DATE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TIME' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DATE) => OUT: TIME',
      extensible: false,
    },
    {
      name: 'DATE_TO_TOD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DATE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TOD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DATE) => OUT: TOD',
      extensible: false,
    },
    {
      name: 'DATE_TO_DT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DATE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DATE) => OUT: DT',
      extensible: false,
    },
    {
      name: 'DATE_TO_STRING',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DATE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DATE) => OUT: STRING',
      extensible: false,
    },
    {
      name: 'DATE_TO_BYTE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DATE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BYTE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DATE) => OUT: BYTE',
      extensible: false,
    },
    {
      name: 'DATE_TO_WORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DATE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'WORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DATE) => OUT: WORD',
      extensible: false,
    },
    {
      name: 'DATE_TO_DWORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DATE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DATE) => OUT: DWORD',
      extensible: false,
    },
    {
      name: 'DATE_TO_LWORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DATE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DATE) => OUT: LWORD',
      extensible: false,
    },
    {
      name: 'TOD_TO_BOOL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TOD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TOD) => OUT: BOOL',
      extensible: false,
    },
    {
      name: 'TOD_TO_SINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TOD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'SINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TOD) => OUT: SINT',
      extensible: false,
    },
    {
      name: 'TOD_TO_INT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TOD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'INT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TOD) => OUT: INT',
      extensible: false,
    },
    {
      name: 'TOD_TO_DINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TOD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TOD) => OUT: DINT',
      extensible: false,
    },
    {
      name: 'TOD_TO_LINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TOD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TOD) => OUT: LINT',
      extensible: false,
    },
    {
      name: 'TOD_TO_USINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TOD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'USINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TOD) => OUT: USINT',
      extensible: false,
    },
    {
      name: 'TOD_TO_UINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TOD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TOD) => OUT: UINT',
      extensible: false,
    },
    {
      name: 'TOD_TO_UDINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TOD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UDINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TOD) => OUT: UDINT',
      extensible: false,
    },
    {
      name: 'TOD_TO_ULINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TOD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'ULINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TOD) => OUT: ULINT',
      extensible: false,
    },
    {
      name: 'TOD_TO_REAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TOD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TOD) => OUT: REAL',
      extensible: false,
    },
    {
      name: 'TOD_TO_LREAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TOD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LREAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TOD) => OUT: LREAL',
      extensible: false,
    },
    {
      name: 'TOD_TO_TIME',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TOD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TIME' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TOD) => OUT: TIME',
      extensible: false,
    },
    {
      name: 'TOD_TO_DATE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TOD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DATE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TOD) => OUT: DATE',
      extensible: false,
    },
    {
      name: 'TOD_TO_DT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TOD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TOD) => OUT: DT',
      extensible: false,
    },
    {
      name: 'TOD_TO_STRING',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TOD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TOD) => OUT: STRING',
      extensible: false,
    },
    {
      name: 'TOD_TO_BYTE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TOD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BYTE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TOD) => OUT: BYTE',
      extensible: false,
    },
    {
      name: 'TOD_TO_WORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TOD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'WORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TOD) => OUT: WORD',
      extensible: false,
    },
    {
      name: 'TOD_TO_DWORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TOD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TOD) => OUT: DWORD',
      extensible: false,
    },
    {
      name: 'TOD_TO_LWORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'TOD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: TOD) => OUT: LWORD',
      extensible: false,
    },
    {
      name: 'DT_TO_BOOL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DT) => OUT: BOOL',
      extensible: false,
    },
    {
      name: 'DT_TO_SINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'SINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DT) => OUT: SINT',
      extensible: false,
    },
    {
      name: 'DT_TO_INT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'INT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DT) => OUT: INT',
      extensible: false,
    },
    {
      name: 'DT_TO_DINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DT) => OUT: DINT',
      extensible: false,
    },
    {
      name: 'DT_TO_LINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DT) => OUT: LINT',
      extensible: false,
    },
    {
      name: 'DT_TO_USINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'USINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DT) => OUT: USINT',
      extensible: false,
    },
    {
      name: 'DT_TO_UINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DT) => OUT: UINT',
      extensible: false,
    },
    {
      name: 'DT_TO_UDINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UDINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DT) => OUT: UDINT',
      extensible: false,
    },
    {
      name: 'DT_TO_ULINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'ULINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DT) => OUT: ULINT',
      extensible: false,
    },
    {
      name: 'DT_TO_REAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DT) => OUT: REAL',
      extensible: false,
    },
    {
      name: 'DT_TO_LREAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LREAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DT) => OUT: LREAL',
      extensible: false,
    },
    {
      name: 'DT_TO_TIME',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TIME' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DT) => OUT: TIME',
      extensible: false,
    },
    {
      name: 'DT_TO_DATE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DATE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DT) => OUT: DATE',
      extensible: false,
    },
    {
      name: 'DT_TO_TOD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TOD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DT) => OUT: TOD',
      extensible: false,
    },
    {
      name: 'DT_TO_STRING',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DT) => OUT: STRING',
      extensible: false,
    },
    {
      name: 'DT_TO_BYTE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BYTE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DT) => OUT: BYTE',
      extensible: false,
    },
    {
      name: 'DT_TO_WORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'WORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DT) => OUT: WORD',
      extensible: false,
    },
    {
      name: 'DT_TO_DWORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DT) => OUT: DWORD',
      extensible: false,
    },
    {
      name: 'DT_TO_LWORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DT) => OUT: LWORD',
      extensible: false,
    },
    {
      name: 'STRING_TO_BOOL',
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
          type: { definition: 'base-type', value: 'BOOL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: STRING) => OUT: BOOL',
      extensible: false,
    },
    {
      name: 'STRING_TO_SINT',
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
          type: { definition: 'base-type', value: 'SINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: STRING) => OUT: SINT',
      extensible: false,
    },
    {
      name: 'STRING_TO_INT',
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
          type: { definition: 'base-type', value: 'INT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: STRING) => OUT: INT',
      extensible: false,
    },
    {
      name: 'STRING_TO_DINT',
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
          type: { definition: 'base-type', value: 'DINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: STRING) => OUT: DINT',
      extensible: false,
    },
    {
      name: 'STRING_TO_LINT',
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
          type: { definition: 'base-type', value: 'LINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: STRING) => OUT: LINT',
      extensible: false,
    },
    {
      name: 'STRING_TO_USINT',
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
          type: { definition: 'base-type', value: 'USINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: STRING) => OUT: USINT',
      extensible: false,
    },
    {
      name: 'STRING_TO_UINT',
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
          type: { definition: 'base-type', value: 'UINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: STRING) => OUT: UINT',
      extensible: false,
    },
    {
      name: 'STRING_TO_UDINT',
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
          type: { definition: 'base-type', value: 'UDINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: STRING) => OUT: UDINT',
      extensible: false,
    },
    {
      name: 'STRING_TO_ULINT',
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
          type: { definition: 'base-type', value: 'ULINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: STRING) => OUT: ULINT',
      extensible: false,
    },
    {
      name: 'STRING_TO_REAL',
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
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: STRING) => OUT: REAL',
      extensible: false,
    },
    {
      name: 'STRING_TO_LREAL',
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
          type: { definition: 'base-type', value: 'LREAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: STRING) => OUT: LREAL',
      extensible: false,
    },
    {
      name: 'STRING_TO_TIME',
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
          type: { definition: 'base-type', value: 'TIME' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: STRING) => OUT: TIME',
      extensible: false,
    },
    {
      name: 'STRING_TO_DATE',
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
          type: { definition: 'base-type', value: 'DATE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: STRING) => OUT: DATE',
      extensible: false,
    },
    {
      name: 'STRING_TO_TOD',
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
          type: { definition: 'base-type', value: 'TOD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: STRING) => OUT: TOD',
      extensible: false,
    },
    {
      name: 'STRING_TO_DT',
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
          type: { definition: 'base-type', value: 'DT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: STRING) => OUT: DT',
      extensible: false,
    },
    {
      name: 'STRING_TO_BYTE',
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
          type: { definition: 'base-type', value: 'BYTE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: STRING) => OUT: BYTE',
      extensible: false,
    },
    {
      name: 'STRING_TO_WORD',
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
          type: { definition: 'base-type', value: 'WORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: STRING) => OUT: WORD',
      extensible: false,
    },
    {
      name: 'STRING_TO_DWORD',
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
          type: { definition: 'base-type', value: 'DWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: STRING) => OUT: DWORD',
      extensible: false,
    },
    {
      name: 'STRING_TO_LWORD',
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
          type: { definition: 'base-type', value: 'LWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: STRING) => OUT: LWORD',
      extensible: false,
    },
    {
      name: 'BYTE_TO_BOOL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BYTE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BYTE) => OUT: BOOL',
      extensible: false,
    },
    {
      name: 'BYTE_TO_SINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BYTE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'SINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BYTE) => OUT: SINT',
      extensible: false,
    },
    {
      name: 'BYTE_TO_INT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BYTE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'INT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BYTE) => OUT: INT',
      extensible: false,
    },
    {
      name: 'BYTE_TO_DINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BYTE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BYTE) => OUT: DINT',
      extensible: false,
    },
    {
      name: 'BYTE_TO_LINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BYTE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BYTE) => OUT: LINT',
      extensible: false,
    },
    {
      name: 'BYTE_TO_USINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BYTE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'USINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BYTE) => OUT: USINT',
      extensible: false,
    },
    {
      name: 'BYTE_TO_UINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BYTE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BYTE) => OUT: UINT',
      extensible: false,
    },
    {
      name: 'BYTE_TO_UDINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BYTE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UDINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BYTE) => OUT: UDINT',
      extensible: false,
    },
    {
      name: 'BYTE_TO_ULINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BYTE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'ULINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BYTE) => OUT: ULINT',
      extensible: false,
    },
    {
      name: 'BYTE_TO_REAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BYTE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BYTE) => OUT: REAL',
      extensible: false,
    },
    {
      name: 'BYTE_TO_LREAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BYTE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LREAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BYTE) => OUT: LREAL',
      extensible: false,
    },
    {
      name: 'BYTE_TO_TIME',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BYTE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TIME' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BYTE) => OUT: TIME',
      extensible: false,
    },
    {
      name: 'BYTE_TO_DATE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BYTE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DATE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BYTE) => OUT: DATE',
      extensible: false,
    },
    {
      name: 'BYTE_TO_TOD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BYTE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TOD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BYTE) => OUT: TOD',
      extensible: false,
    },
    {
      name: 'BYTE_TO_DT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BYTE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BYTE) => OUT: DT',
      extensible: false,
    },
    {
      name: 'BYTE_TO_STRING',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BYTE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BYTE) => OUT: STRING',
      extensible: false,
    },
    {
      name: 'BYTE_TO_WORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BYTE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'WORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BYTE) => OUT: WORD',
      extensible: false,
    },
    {
      name: 'BYTE_TO_DWORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BYTE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BYTE) => OUT: DWORD',
      extensible: false,
    },
    {
      name: 'BYTE_TO_LWORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BYTE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: BYTE) => OUT: LWORD',
      extensible: false,
    },
    {
      name: 'WORD_TO_BOOL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'WORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: WORD) => OUT: BOOL',
      extensible: false,
    },
    {
      name: 'WORD_TO_SINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'WORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'SINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: WORD) => OUT: SINT',
      extensible: false,
    },
    {
      name: 'WORD_TO_INT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'WORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'INT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: WORD) => OUT: INT',
      extensible: false,
    },
    {
      name: 'WORD_TO_DINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'WORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: WORD) => OUT: DINT',
      extensible: false,
    },
    {
      name: 'WORD_TO_LINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'WORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: WORD) => OUT: LINT',
      extensible: false,
    },
    {
      name: 'WORD_TO_USINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'WORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'USINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: WORD) => OUT: USINT',
      extensible: false,
    },
    {
      name: 'WORD_TO_UINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'WORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: WORD) => OUT: UINT',
      extensible: false,
    },
    {
      name: 'WORD_TO_UDINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'WORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UDINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: WORD) => OUT: UDINT',
      extensible: false,
    },
    {
      name: 'WORD_TO_ULINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'WORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'ULINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: WORD) => OUT: ULINT',
      extensible: false,
    },
    {
      name: 'WORD_TO_REAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'WORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: WORD) => OUT: REAL',
      extensible: false,
    },
    {
      name: 'WORD_TO_LREAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'WORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LREAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: WORD) => OUT: LREAL',
      extensible: false,
    },
    {
      name: 'WORD_TO_TIME',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'WORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TIME' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: WORD) => OUT: TIME',
      extensible: false,
    },
    {
      name: 'WORD_TO_DATE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'WORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DATE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: WORD) => OUT: DATE',
      extensible: false,
    },
    {
      name: 'WORD_TO_TOD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'WORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TOD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: WORD) => OUT: TOD',
      extensible: false,
    },
    {
      name: 'WORD_TO_DT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'WORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: WORD) => OUT: DT',
      extensible: false,
    },
    {
      name: 'WORD_TO_BYTE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'WORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BYTE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: WORD) => OUT: BYTE',
      extensible: false,
    },
    {
      name: 'WORD_TO_STRING',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'WORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: WORD) => OUT: STRING',
      extensible: false,
    },
    {
      name: 'DWORD_TO_BOOL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DWORD) => OUT: BOOL',
      extensible: false,
    },
    {
      name: 'DWORD_TO_SINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'SINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DWORD) => OUT: SINT',
      extensible: false,
    },
    {
      name: 'DWORD_TO_INT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'INT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DWORD) => OUT: INT',
      extensible: false,
    },
    {
      name: 'DWORD_TO_DINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DWORD) => OUT: DINT',
      extensible: false,
    },
    {
      name: 'DWORD_TO_LINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DWORD) => OUT: LINT',
      extensible: false,
    },
    {
      name: 'DWORD_TO_USINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'USINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DWORD) => OUT: USINT',
      extensible: false,
    },
    {
      name: 'DWORD_TO_UINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DWORD) => OUT: UINT',
      extensible: false,
    },
    {
      name: 'DWORD_TO_UDINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UDINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DWORD) => OUT: UDINT',
      extensible: false,
    },
    {
      name: 'DWORD_TO_ULINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'ULINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DWORD) => OUT: ULINT',
      extensible: false,
    },
    {
      name: 'DWORD_TO_REAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DWORD) => OUT: REAL',
      extensible: false,
    },
    {
      name: 'DWORD_TO_LREAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LREAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DWORD) => OUT: LREAL',
      extensible: false,
    },
    {
      name: 'DWORD_TO_TIME',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TIME' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DWORD) => OUT: TIME',
      extensible: false,
    },
    {
      name: 'DWORD_TO_DATE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DATE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DWORD) => OUT: DATE',
      extensible: false,
    },
    {
      name: 'DWORD_TO_TOD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TOD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DWORD) => OUT: TOD',
      extensible: false,
    },
    {
      name: 'DWORD_TO_DT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DWORD) => OUT: DT',
      extensible: false,
    },
    {
      name: 'DWORD_TO_BYTE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BYTE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DWORD) => OUT: BYTE',
      extensible: false,
    },
    {
      name: 'DWORD_TO_WORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'WORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DWORD) => OUT: WORD',
      extensible: false,
    },
    {
      name: 'DWORD_TO_STRING',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: DWORD) => OUT: STRING',
      extensible: false,
    },
    {
      name: 'LWORD_TO_BOOL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LWORD) => OUT: BOOL',
      extensible: false,
    },
    {
      name: 'LWORD_TO_SINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'SINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LWORD) => OUT: SINT',
      extensible: false,
    },
    {
      name: 'LWORD_TO_INT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'INT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LWORD) => OUT: INT',
      extensible: false,
    },
    {
      name: 'LWORD_TO_DINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LWORD) => OUT: DINT',
      extensible: false,
    },
    {
      name: 'LWORD_TO_LINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LWORD) => OUT: LINT',
      extensible: false,
    },
    {
      name: 'LWORD_TO_USINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'USINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LWORD) => OUT: USINT',
      extensible: false,
    },
    {
      name: 'LWORD_TO_UINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LWORD) => OUT: UINT',
      extensible: false,
    },
    {
      name: 'LWORD_TO_UDINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UDINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LWORD) => OUT: UDINT',
      extensible: false,
    },
    {
      name: 'LWORD_TO_ULINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'ULINT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LWORD) => OUT: ULINT',
      extensible: false,
    },
    {
      name: 'LWORD_TO_REAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LWORD) => OUT: REAL',
      extensible: false,
    },
    {
      name: 'LWORD_TO_LREAL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LREAL' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LWORD) => OUT: LREAL',
      extensible: false,
    },
    {
      name: 'LWORD_TO_TIME',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TIME' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LWORD) => OUT: TIME',
      extensible: false,
    },
    {
      name: 'LWORD_TO_DATE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DATE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LWORD) => OUT: DATE',
      extensible: false,
    },
    {
      name: 'LWORD_TO_TOD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TOD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LWORD) => OUT: TOD',
      extensible: false,
    },
    {
      name: 'LWORD_TO_DT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DT' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LWORD) => OUT: DT',
      extensible: false,
    },
    {
      name: 'LWORD_TO_BYTE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BYTE' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LWORD) => OUT: BYTE',
      extensible: false,
    },
    {
      name: 'LWORD_TO_WORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'WORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LWORD) => OUT: WORD',
      extensible: false,
    },
    {
      name: 'LWORD_TO_DWORD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DWORD' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LWORD) => OUT: DWORD',
      extensible: false,
    },
    {
      name: 'LWORD_TO_STRING',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' },
        },
      ],
      body: 'Data type conversion',
      documentation: '(IN: LWORD) => OUT: STRING',
      extensible: false,
    },
    {
      name: 'TRUNC',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_REAL' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'generic-type', value: 'ANY_INT' },
        },
      ],
      body: 'Rounding up/down',
      documentation: '(IN: ANY_REAL) => OUT: ANY_INT',
      extensible: false,
    },
    {
      name: 'BCD_TO_USINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BYTE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'USINT' },
        },
      ],
      body: 'Conversion from BCD',
      documentation: '(IN: BYTE) => OUT: USINT',
      extensible: false,
    },
    {
      name: 'BCD_TO_UINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'WORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UINT' },
        },
      ],
      body: 'Conversion from BCD',
      documentation: '(IN: WORD) => OUT: UINT',
      extensible: false,
    },
    {
      name: 'BCD_TO_UDINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'DWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'UDINT' },
        },
      ],
      body: 'Conversion from BCD',
      documentation: '(IN: DWORD) => OUT: UDINT',
      extensible: false,
    },
    {
      name: 'BCD_TO_ULINT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'LWORD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'ULINT' },
        },
      ],
      body: 'Conversion from BCD',
      documentation: '(IN: LWORD) => OUT: ULINT',
      extensible: false,
    },
    {
      name: 'USINT_TO_BCD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'USINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BYTE' },
        },
      ],
      body: 'Conversion to BCD',
      documentation: '(IN: USINT) => OUT: BYTE',
      extensible: false,
    },
    {
      name: 'UINT_TO_BCD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'WORD' },
        },
      ],
      body: 'Conversion to BCD',
      documentation: '(IN: UINT) => OUT: WORD',
      extensible: false,
    },
    {
      name: 'UDINT_TO_BCD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'UDINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DWORD' },
        },
      ],
      body: 'Conversion to BCD',
      documentation: '(IN: UDINT) => OUT: DWORD',
      extensible: false,
    },
    {
      name: 'ULINT_TO_BCD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'ULINT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'LWORD' },
        },
      ],
      body: 'Conversion to BCD',
      documentation: '(IN: ULINT) => OUT: LWORD',
      extensible: false,
    },
    {
      name: 'DATE_AND_TIME_TO_TIME_OF_DAY',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'DT',
          class: 'input',
          type: { definition: 'base-type', value: 'DT' },
        },
        {
          name: 'TOD',
          class: 'output',
          type: { definition: 'base-type', value: 'TOD' },
        },
      ],
      body: 'Conversion to time-of-day',
      documentation: '(IN: DT) => OUT: TOD',
      extensible: false,
    },
    {
      name: 'DATE_AND_TIME_TO_DATE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'DT',
          class: 'input',
          type: { definition: 'base-type', value: 'DT' },
        },
        {
          name: 'DATE',
          class: 'output',
          type: { definition: 'base-type', value: 'DATE' },
        },
      ],
      body: 'Conversion to date',
      documentation: '(IN: DT) => OUT: DATE',
      extensible: false,
    },
  ],
}

export { TypeConversion, TypeConversionLibrarySchema }
