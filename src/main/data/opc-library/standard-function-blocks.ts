import { PLCFunctionBlock } from '@root/types/PLC/open-plc'

const _StandardFunctionBlocks: PLCFunctionBlock[] = [
  {
    name: 'SR',
    language: 'st',
    variables: [
      {
        name: 'S1',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'S1 location',
        documentation: 'S1 documentation',
        debug: false,
      },
      {
        name: 'R',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: "R location",
        documentation: 'R documentation',
        debug: false,
      },
      {
        name: 'Q1',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: "Q1 location",
        documentation: 'Q1 documentation',
        debug: false,
      },
    ],
    body: 'Q1 := S1 OR ((NOT R) AND Q1);',
    documentation: 'The SR bistable is a latch where the Set dominates.',
  },
  {
    name: "RS",
    language: "st",
    variables: [
      {
        name: "S",
        class: "input",
        type: {
          definition: "base-type",
          value: "bool"
        },
        location: "S location",
        documentation: "S documentation",
        debug: false
      },
      {
        name: "R1",
        class: "input",
        type: {
          definition: "base-type",
          value: "bool"
        },
        location: "R1 location",
        documentation: "R1 documentation",
        debug: false
      },
      {
        name: "Q1",
        class: "output",
        type: {
          definition: "base-type",
          value: "bool"
        },
        location: "Q1 location",
        documentation: "Q1 documentation",
        debug: false
      }
    ],
    body: 'Q1 := (NOT R1) AND (S OR Q1);',
    documentation: 'The RS bistable is a latch where the Reset dominates.'
  }
]
