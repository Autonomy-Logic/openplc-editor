import { BaseLibraryPouSchema, BaseLibrarySchema, BaseLibraryVariableSchema } from '@root/types/PLC/library'
import { z } from 'zod'

const BitShiftVariableSchema = BaseLibraryVariableSchema

const BitShiftPouSchema = BaseLibraryPouSchema.extend({
  variables: z.array(BitShiftVariableSchema),
})

const BitShiftLibrarySchema = BaseLibrarySchema.extend({
  pous: z.array(BitShiftPouSchema),
})

type BitShiftLibrary = z.infer<typeof BitShiftLibrarySchema>

const BitShift: BitShiftLibrary = {
  name: 'BitShift',
  version: '1.0.0',
  author: 'Autonomy Logic',
  stPath: 'path/to/st/file',
  cPath: 'path/to/c/file',
  pous: [
    {
      name: 'SHL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'STRING' }, // Dont have a type for BIT
        },
        {
          name: 'N',
          class: 'input',
          type: { definition: 'base-type', value: 'INT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' }, // Dont have a type for BIT
        },
      ],
      body: 'Shift Left',
      documentation: '(IN: ANY_BIT, N:INT) -> OUT:ANY_BIT',
      extensible: false,
    },
    {
      name: 'SHR',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'STRING' }, // Dont have a type for BIT
        },
        {
          name: 'N',
          class: 'input',
          type: { definition: 'base-type', value: 'INT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' }, // Dont have a type for BIT
        },
      ],
      body: 'Shift Right',
      documentation: '(IN: ANY_BIT, N:INT) -> OUT:ANY_BIT',
      extensible: false,
    },
    {
      name: 'ROR',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'STRING' }, // Dont have a type for NBIT
        },
        {
          name: 'N',
          class: 'input',
          type: { definition: 'base-type', value: 'INT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' }, // Dont have a type for NBIT
        },
      ],
      body: 'Rotate Right',
      documentation: '(IN: ANY_NBIT, N:INT) -> OUT:ANY_NBIT',
      extensible: false,
    },
    {
      name: 'ROL',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'STRING' }, // Dont have a type for NBIT
        },
        {
          name: 'N',
          class: 'input',
          type: { definition: 'base-type', value: 'INT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' }, // Dont have a type for NBIT
        },
      ],
      body: 'Rotate Left',
      documentation: '(IN: ANY_NBIT, N:INT) -> OUT:ANY_NBIT',
      extensible: false,
    },
  ]
}

export { BitShift }
