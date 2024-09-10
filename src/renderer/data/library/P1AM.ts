import { BaseLibraryPouSchema, BaseLibrarySchema, BaseLibraryVariableSchema } from '@root/types/PLC/library'
import { z } from 'zod'

const P1AMVariablesSchema = BaseLibraryVariableSchema

const P1AMPouSchema = BaseLibraryPouSchema.extend({
  variables: z.array(P1AMVariablesSchema),
})

const P1AMLibrarySchema = BaseLibrarySchema.extend({
  pous: z.array(P1AMPouSchema),
})

type P1AMLibrary = z.infer<typeof P1AMLibrarySchema>

const P1AM: P1AMLibrary = {
  name: 'P1AM',
  version: '1.0.0',
  author: 'Autonomy Logic',
  stPath: 'src/renderer/data/library/p1am/st',
  cPath: 'src/renderer/data/library/p1am/c',
  pous: [
    {
      name: 'P1AM_INIT',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'INIT', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'SUCCESS', class: 'output', type: { definition: 'base-type', value: 'SINT' } },
      ],
      body: 'SUCCESS := 0;',
      documentation:
        "Initialize P1AM Modules and return the number of initialized modules on SUCCESS. If SUCCESS is zero, an error has occurred, or there aren't any modules on the bus",
    },
    {
      name: 'P1_16CDR',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'SLOT', class: 'input', type: { definition: 'base-type', value: 'SINT' } },
        { name: 'O1', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'O2', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'O3', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'O4', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'O5', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'O6', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'O7', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'O8', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'I1', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'I2', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'I3', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'I4', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'I5', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'I6', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'I7', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'I8', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
      ],
      body: 'I1 := 0;',
      documentation:
        'Get all inputs and update all outputs from P1-16CDR module. Also works with P1-15CDD1 and P1-15CDD2',
    },
    {
      name: 'P1_08N',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'SLOT', class: 'input', type: { definition: 'base-type', value: 'SINT' } },
        { name: 'I1', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'I2', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'I3', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'I4', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'I5', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'I6', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'I7', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'I8', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
      ],
      body: 'I1 := 0;',
      documentation: 'Get all inputs from P1-08Nxx modules. Compatible with P1-08NA, P1-08ND3, P1-08NE3 and P1-08SIM',
    },
    {
      name: 'P1_16N',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'SLOT', class: 'input', type: { definition: 'base-type', value: 'SINT' } },
        { name: 'I1', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'I2', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'I3', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'I4', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'I5', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'I6', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'I7', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'I8', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'I9', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'I10', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'I11', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'I12', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'I13', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'I14', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'I15', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'I16', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
      ],
      body: 'I1 := 0;',
      documentation: 'Get all inputs from P1-16Nxx modules. Compatible with P1-16ND3 and P1-16NE3',
    },
    {
      name: 'P1_08T',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'SLOT', class: 'input', type: { definition: 'base-type', value: 'SINT' } },
        { name: 'O1', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'O2', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'O3', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'O4', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'O5', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'O6', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'O7', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'O8', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'DUMMY', class: 'local', type: { definition: 'base-type', value: 'SINT' } },
      ],
      body: 'DUMMY := SLOT;',
      documentation: 'Set all outputs on P1-08Txx modules. Compatible with P1-08TA, P1-08TD1, P1-08TD2 and P1-08TRS',
    },
    {
      name: 'P1_16TR',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'SLOT', class: 'input', type: { definition: 'base-type', value: 'SINT' } },
        { name: 'O1', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'O2', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'O3', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'O4', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'O5', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'O6', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'O7', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'O8', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'O9', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'O10', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'O11', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'O12', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'O13', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'O14', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'O15', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'O16', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'DUMMY', class: 'local', type: { definition: 'base-type', value: 'SINT' } },
      ],
      body: 'DUMMY := SLOT;',
      documentation: 'Set all outputs on P1-16TR modules. Also compatible with P1-15TD1 and P1-15TD2',
    },
    {
      name: 'P1_04AD',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'SLOT', class: 'input', type: { definition: 'base-type', value: 'SINT' } },
        { name: 'I1', class: 'output', type: { definition: 'base-type', value: 'UINT' } },
        { name: 'I2', class: 'output', type: { definition: 'base-type', value: 'UINT' } },
        { name: 'I3', class: 'output', type: { definition: 'base-type', value: 'UINT' } },
        { name: 'I4', class: 'output', type: { definition: 'base-type', value: 'UINT' } },
        { name: 'DUMMY', class: 'local', type: { definition: 'base-type', value: 'SINT' } },
      ],
      body: 'DUMMY := SLOT;',
      documentation: 'Get all analog inputs from P1-04ADxx modules. Compatible with P1-04AD, P1-04ADL-1 and P1-04ADL-2',
    },
  ],
}

export { P1AM }
