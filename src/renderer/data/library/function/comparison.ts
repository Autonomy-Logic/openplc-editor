import { BaseLibraryPouSchema, BaseLibrarySchema, BaseLibraryVariableSchema } from '@root/types/PLC/library'
import { z } from 'zod'

const ComparisonVariableSchema = BaseLibraryVariableSchema

const ComparisonPouSchema = BaseLibraryPouSchema.extend({
  variables: z.array(ComparisonVariableSchema),
})

const ComparisonLibrarySchema = BaseLibrarySchema.extend({
  pous: z.array(ComparisonPouSchema),
})

type ComparisonLibrary = z.infer<typeof ComparisonLibrarySchema>

const Comparison: ComparisonLibrary = {
  name: 'Comparison',
  version: '1.0.0',
  author: 'Autonomy Logic',
  stPath: 'path/to/st/file',
  cPath: 'path/to/c/file',
  pous: [
    {
      name: 'GT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'base-type', value: 'STRING' }, // Dont have a type for ANY
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'base-type', value: 'STRING' }, // Dont have a type for ANY
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
        },
      ],
      body: 'Greater Than',
      documentation: '(IN1: ANY, IN2: ANY) -> OUT:BOOL',
      extensible: true,
    },
    {
      name: 'GE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'base-type', value: 'STRING' }, // Dont have a type for ANY
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'base-type', value: 'STRING' }, // Dont have a type for ANY
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
        },
      ],
      body: 'Greater Than or equal to',
      documentation: '(IN1: ANY, IN2: ANY) -> OUT:BOOL',
      extensible: true,
    },
    {
      name: 'EQ',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'base-type', value: 'STRING' }, // Dont have a type for ANY
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'base-type', value: 'STRING' }, // Dont have a type for ANY
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
        },
      ],
      body: 'Equal to',
      documentation: '(IN1: ANY, IN2: ANY) -> OUT:BOOL',
      extensible: true,
    },
    {
      name: 'LT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'base-type', value: 'STRING' }, // Dont have a type for ANY
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'base-type', value: 'STRING' }, // Dont have a type for ANY
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
        },
      ],
      body: 'Less Than',
      documentation: '(IN1: ANY, IN2: ANY) -> OUT:BOOL',
      extensible: true,
    },
    {
      name: 'LE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'base-type', value: 'STRING' }, // Dont have a type for ANY
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'base-type', value: 'STRING' }, // Dont have a type for ANY
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
        },
      ],
      body: 'Less Than or equal to',
      documentation: '(IN1: ANY, IN2: ANY) -> OUT:BOOL',
      extensible: true,
    },
    {
      name: 'NE',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'base-type', value: 'STRING' }, // Dont have a type for ANY
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'base-type', value: 'STRING' }, // Dont have a type for ANY
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
        },
      ],
      body: 'Not Equal to',
      documentation: '(IN1: ANY, IN2: ANY) -> OUT:BOOL',
      extensible: false,
    },
  ],
}

export { Comparison }
