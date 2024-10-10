import { BaseLibraryPouSchema, BaseLibrarySchema, BaseLibraryVariableSchema, baseTypeSchema, genericTypeSchema } from '@root/types/PLC'
import { z } from 'zod'

const CharacterStringVariableSchema = BaseLibraryVariableSchema.extend({
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

const CharacterStringPouSchema = BaseLibraryPouSchema.extend({
  variables: z.array(CharacterStringVariableSchema),
})

const CharacterStringLibrarySchema = BaseLibrarySchema.extend({
  pous: z.array(CharacterStringPouSchema),
})

type CharacterStringLibrary = z.infer<typeof CharacterStringLibrarySchema>

const CharacterString: CharacterStringLibrary = {
  name: 'CharacterString',
  version: '1.0.0',
  author: 'Autonomy Logic',
  stPath: 'path/to/st/file',
  cPath: 'path/to/c/file',
  pous: [
    {
      name: 'LEN',
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
      body: 'Length of string',
      documentation: '(IN:STRING) => OUT:INT',
      extensible: false,
    },
    {
      name: 'LEFT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'STRING' },
        },
        {
          name: 'L',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_INT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' },
        },
      ],
      body: 'String left of',
      documentation: '(IN:STRING, L:ANY_INT) => OUT:STRING',
      extensible: false,
    },
    {
      name: 'RIGHT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'STRING' },
        },
        {
          name: 'L',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_INT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' },
        },
      ],
      body: 'String right of',
      documentation: '(IN:STRING, L:ANY_INT) => OUT:STRING',
      extensible: false,
    },
    {
      name: 'MID',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'STRING' },
        },
        {
          name: 'L',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_INT' },
        },
        {
          name: 'S',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_INT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' },
        },
      ],
      body: 'String from middle of',
      documentation: '(IN:STRING, L:ANY_INT, S:ANY_INT) => OUT:STRING',
      extensible: false,
    },
    {
      name: 'CONCAT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'base-type', value: 'STRING' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'base-type', value: 'STRING' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' },
        },
      ],
      body: 'Concatenation',
      documentation: '(IN1:STRING, IN2:STRING) => OUT:STRING',
      extensible: true,
    },
    {
      name: 'CONCAT_DATE_TOD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'base-type', value: 'DATE' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'base-type', value: 'TOD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DT' },
        },
      ],
      body: 'Time concatenation',
      documentation: '(IN1:DATE, IN2:TOD) => OUT:DT',
      extensible: false,
    },
    {
      name: 'INSERT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'base-type', value: 'STRING' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'base-type', value: 'STRING' },
        },
        {
          name: 'P',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_INT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' },
        },
      ],
      body: 'Insertion (into)',
      documentation: '(IN1:STRING, IN2:STRING, P:ANY_INT) => OUT:STRING',
      extensible: false,
    },
    {
      name: 'DELETE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'STRING' },
        },
        {
          name: 'L',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_INT' },
        },
        {
          name: 'P',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_INT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' },
        },
      ],
      body: 'Deletion (within)',
      documentation: '(IN:STRING, L:ANY_INT, P:ANY_INT) => OUT:STRING',
      extensible: false,
    },
    {
      name: 'REPLACE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'base-type', value: 'STRING' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'base-type', value: 'STRING' },
        },
        {
          name: 'L',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_INT' },
        },
        {
          name: 'P',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_INT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'STRING' },
        },
      ],
      body: 'Replacement (within)',
      documentation: '(IN1:STRING, IN2:STRING, L:ANY_INT, P:ANY_INT) => OUT:STRING',
      extensible: false,
    },
    {
      name: 'FIND',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'base-type', value: 'STRING' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'base-type', value: 'STRING' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'INT' },
        },
      ],
      body: 'Find position',
      documentation: '(IN1:STRING, IN2:STRING) => OUT:INT',
      extensible: false,
    },
  ],
}

export { CharacterString, CharacterStringLibrarySchema }
