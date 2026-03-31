import {
  BaseLibraryPouSchema,
  BaseLibrarySchema,
  BaseLibraryVariableSchema,
  baseTypeSchema,
  genericTypeSchema,
} from '@root/types/PLC'
import { z } from 'zod'

const TimeVariableSchema = BaseLibraryVariableSchema.extend({
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

const TimePouSchema = BaseLibraryPouSchema.extend({
  variables: z.array(TimeVariableSchema),
})

const TimeLibrarySchema = BaseLibrarySchema.extend({
  pous: z.array(TimePouSchema),
})

type TimeLibrary = z.infer<typeof TimeLibrarySchema>

const Time: TimeLibrary = {
  name: 'Time',
  version: '1.0.0',
  author: 'Autonomy Logic',
  stPath: 'path/to/st/file',
  cPath: 'path/to/c/file',
  pous: [
    {
      name: 'ADD_TIME',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TIME' },
        },
      ],
      body: 'Time addition',
      documentation: '(IN1:TIME, IN2:TIME) => OUT:TIME',
      extensible: false,
    },
    {
      name: 'ADD_TOD_TIME',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'base-type', value: 'TOD' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TOD' },
        },
      ],
      body: 'Time-of-day addition',
      documentation: '(IN1:TOD, IN2:TIME) => OUT:TOD',
      extensible: false,
    },
    {
      name: 'ADD_DT_TIME',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'base-type', value: 'DT' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DT' },
        },
      ],
      body: 'Date addition',
      documentation: '(IN1:DT, IN2:TIME) => OUT:DT',
      extensible: false,
    },
    {
      name: 'MUL_TIME',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_NUM' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TIME' },
        },
      ],
      body: 'Time multiplication',
      documentation: '(IN1:TIME, IN2:ANY_NUM) => OUT:TIME',
      extensible: false,
    },
    {
      name: 'SUB_TIME',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TIME' },
        },
      ],
      body: 'Time subtraction',
      documentation: '(IN1:TIME, IN2:TIME) => OUT:TIME',
      extensible: false,
    },
    {
      name: 'SUB_DATE',
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
          type: { definition: 'base-type', value: 'DATE' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TIME' },
        },
      ],
      body: 'Date subtraction',
      documentation: '(IN1:DATE, IN2:DATE) => OUT:TIME',
      extensible: false,
    },
    {
      name: 'SUB_TOD_TIME',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'base-type', value: 'TOD' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TOD' },
        },
      ],
      body: 'Time-of-day subtraction',
      documentation: '(IN1:TOD, IN2:TIME) => OUT:TOD',
      extensible: false,
    },
    {
      name: 'SUB_TOD',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'base-type', value: 'TOD' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'base-type', value: 'TOD' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TIME' },
        },
      ],
      body: 'Time-of-day subtraction',
      documentation: '(IN1:TOD, IN2:TOD) => OUT:TIME',
      extensible: false,
    },
    {
      name: 'SUB_DT_TIME',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'base-type', value: 'DT' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'DT' },
        },
      ],
      body: 'Date and time subtraction',
      documentation: '(IN1:DT, IN2:TIME) => OUT:DT',
      extensible: false,
    },
    {
      name: 'SUB_DT',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'base-type', value: 'DT' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'base-type', value: 'DT' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TIME' },
        },
      ],
      body: 'Date and time subtraction',
      documentation: '(IN1:DT, IN2:DT) => OUT:TIME',
      extensible: false,
    },
    {
      name: 'DIV_TIME',
      type: 'function',
      language: 'st',
      variables: [
        {
          name: 'IN1',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
        },
        {
          name: 'IN2',
          class: 'input',
          type: { definition: 'generic-type', value: 'ANY_NUM' },
        },
        {
          name: 'OUT',
          class: 'output',
          type: { definition: 'base-type', value: 'TIME' },
        },
      ],
      body: 'Time division',
      documentation: '(IN1:TIME, IN2:ANY_NUM) => OUT:TIME',
      extensible: false,
    },
  ],
}

export { Time, TimeLibrarySchema }
