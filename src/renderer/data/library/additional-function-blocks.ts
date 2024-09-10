import {
  BaseLibraryPouSchema,
  BaseLibrarySchema,
  BaseLibraryVariableSchema,
  baseTypeSchema,
} from '@root/types/PLC/library'
import { z } from 'zod'

const AdditionalFunctionBlocksVariablesSchema = BaseLibraryVariableSchema.extend({
  type: z.discriminatedUnion('definition', [
    z.object({
      definition: z.literal('base-type'),
      value: baseTypeSchema,
    }),
    z.object({
      definition: z.literal('derived-type'),
      value: z.string(),
    }),
  ]),
  initialValue: z
    .lazy((): z.Schema<unknown> => AdditionalFunctionBlocksVariablesSchema.pick({ type: true }))
    .optional(),
})

const AdditionalFunctionBlocksPouSchema = BaseLibraryPouSchema.extend({
  variables: z.array(AdditionalFunctionBlocksVariablesSchema),
})

const AdditionalFunctionBlocksLibrarySchema = BaseLibrarySchema.extend({
  pous: z.array(AdditionalFunctionBlocksPouSchema),
})

type AdditionalFunctionBlocksLibrary = z.infer<typeof AdditionalFunctionBlocksLibrarySchema>

const AdditionalFunctionBlocks: AdditionalFunctionBlocksLibrary = {
  name: 'Additional Function Blocks',
  version: '1.0.0',
  author: 'Autonomy Logic',
  stPath: 'dummypath/wichwillbereplacedlater',
  cPath: 'dummypath/wichwillbereplacedlater',
  pous: [
    {
      name: 'RTC',
      type: 'function-block',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
          documentation: '0 - current time, 1 - load time from PDT',
        },
        {
          name: 'PDT',
          class: 'input',
          type: { definition: 'base-type', value: 'DT' },
          documentation: 'Preset datetime',
        },
        {
          name: 'Q',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
          initialValue: { value: 'FALSE' },
          documentation: 'Copy of IN',
        },
        {
          name: 'CDT',
          class: 'output',
          type: { definition: 'base-type', value: 'DT' },
          documentation: 'Datetime, current or relative to PDT',
        },
        {
          name: 'PREV_IN',
          class: 'local',
          type: { definition: 'base-type', value: 'BOOL' },
          initialValue: { value: 'FALSE' },
        },
        { name: 'OFFSET', class: 'local', type: { definition: 'base-type', value: 'TIME' } },
        { name: 'CURRENT_TIME', class: 'local', type: { definition: 'base-type', value: 'DT' } },
      ],
      body: '{__SET_VAR(data__->,CURRENT_TIME,,__CURRENT_TIME)}\n\n IF IN\n THEN\n   IF NOT PREV_IN\n   THEN\n       OFFSET := PDT - CURRENT_TIME;\n   END_IF;\n\n   (* PDT + time since PDT was loaded *)\n   CDT := CURRENT_TIME + OFFSET;\n ELSE\n   CDT := CURRENT_TIME;\n END_IF;\n\n Q := IN;\n PREV_IN := IN;',
      documentation:
        'The real time clock has many uses including time stamping, setting dates and times of day in batch reports, in alarm messages and so on.',
    },
    {
      name: 'INTEGRAL',
      type: 'function-block',
      language: 'st',
      variables: [
        {
          name: 'RUN',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
          documentation: '1 = integrate, 0 = hold',
        },
        {
          name: 'R1',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
          documentation: 'Overriding reset',
        },
        {
          name: 'XIN',
          class: 'input',
          type: { definition: 'base-type', value: 'REAL' },
          documentation: 'Input variable',
        },
        {
          name: 'X0',
          class: 'input',
          type: { definition: 'base-type', value: 'REAL' },
          documentation: 'Initial value',
        },
        {
          name: 'CYCLE',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
          documentation: 'Sampling period',
        },
        { name: 'Q', class: 'output', type: { definition: 'base-type', value: 'BOOL' }, documentation: 'NOT R1' },
        {
          name: 'XOUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
          documentation: 'Integrated output',
        },
      ],
      body: 'Q := NOT R1 ;\nIF R1 THEN XOUT := X0;\nELSIF RUN THEN XOUT := XOUT + XIN * TIME_TO_REAL(CYCLE);\nEND_IF;',
      documentation: 'The integral function block integrates the value of input XIN over time.',
    },
    {
      name: 'DERIVATIVE',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'RUN', class: 'input', type: { definition: 'base-type', value: 'BOOL' }, documentation: '0 = reset' },
        {
          name: 'XIN',
          class: 'input',
          type: { definition: 'base-type', value: 'REAL' },
          documentation: 'Input to be differentiated',
        },
        {
          name: 'CYCLE',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
          documentation: 'Sampling period',
        },
        {
          name: 'XOUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
          documentation: 'Differentiated output',
        },
        { name: 'X1', class: 'local', type: { definition: 'base-type', value: 'REAL' } },
        { name: 'X2', class: 'local', type: { definition: 'base-type', value: 'REAL' } },
        { name: 'X3', class: 'local', type: { definition: 'base-type', value: 'REAL' } },
      ],
      body: 'IF RUN THEN\n  XOUT := (3.0 * (XIN - X3) + X1 - X2)\n          / (10.0 * TIME_TO_REAL(CYCLE));\n  X3 := X2;\n  X2 := X1;\n  X1 := XIN;\nELSE \n  XOUT := 0.0;\n  X1 := XIN;\n  X2 := XIN;\n  X3 := XIN;\nEND_IF;',
      documentation:
        'The derivative function block produces an output XOUT proportional to the rate of change of the input XIN.',
    },
    {
      name: 'PID',
      type: 'function-block',
      language: 'st',
      variables: [
        {
          name: 'AUTO',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
          documentation: '0 - manual, 1 - automatic',
        },
        {
          name: 'PV',
          class: 'input',
          type: { definition: 'base-type', value: 'REAL' },
          documentation: 'Process variable',
        },
        { name: 'SP', class: 'input', type: { definition: 'base-type', value: 'REAL' }, documentation: 'Set point' },
        {
          name: 'X0',
          class: 'input',
          type: { definition: 'base-type', value: 'REAL' },
          documentation: 'Manual output adjustment - Typically from transfer station',
        },
        {
          name: 'KP',
          class: 'input',
          type: { definition: 'base-type', value: 'REAL' },
          documentation: 'Proportional gain',
        },
        { name: 'TR', class: 'input', type: { definition: 'base-type', value: 'REAL' }, documentation: 'Reset time' },
        {
          name: 'TD',
          class: 'input',
          type: { definition: 'base-type', value: 'REAL' },
          documentation: 'Derivative time constant',
        },
        {
          name: 'CYCLE',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
          documentation: 'Sampling period',
        },
        { name: 'XOUT', class: 'output', type: { definition: 'base-type', value: 'REAL' } },
        { name: 'ERROR', class: 'local', type: { definition: 'base-type', value: 'REAL' }, documentation: 'PV - SP' },
        {
          name: 'ITERM',
          class: 'local',
          type: { definition: 'derived-type', value: 'INTEGRAL' },
          documentation: 'FB for integral term',
        },
        {
          name: 'DTERM',
          class: 'local',
          type: { definition: 'derived-type', value: 'DERIVATIVE' },
          documentation: 'FB for derivative term',
        },
      ],
      body: 'ERROR := PV - SP ;\n(*** Adjust ITERM so that XOUT := X0 when AUTO = 0 ***)\nITERM(RUN := AUTO, R1 := NOT AUTO, XIN := ERROR,\n      X0 := TR * (X0 - ERROR), CYCLE := CYCLE);\nDTERM(RUN := AUTO, XIN := ERROR, CYCLE := CYCLE);\nXOUT := KP * (ERROR + ITERM.XOUT/TR + DTERM.XOUT*TD);',
      documentation:
        'The PID (proportional, Integral, Derivative) function block provides the classical three term controller for closed loop control.',
    },
    {
      name: 'RAMP',
      type: 'function-block',
      language: 'st',
      variables: [
        {
          name: 'RUN',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
          documentation: '0 - track X0, 1 - ramp to/track X1',
        },
        { name: 'X0', class: 'input', type: { definition: 'base-type', value: 'REAL' } },
        { name: 'X1', class: 'input', type: { definition: 'base-type', value: 'REAL' } },
        {
          name: 'TR',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
          documentation: 'Ramp duration',
        },
        {
          name: 'CYCLE',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
          documentation: 'Sampling period',
        },
        {
          name: 'BUSY',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
          documentation: 'BUSY = 1 during ramping period',
        },
        {
          name: 'XOUT',
          class: 'output',
          type: { definition: 'base-type', value: 'REAL' },
          initialValue: { value: '0.0' },
        },
        {
          name: 'XI',
          class: 'local',
          type: { definition: 'base-type', value: 'REAL' },
          initialValue: { value: '0.0' },
          documentation: 'Initial value',
        },
        {
          name: 'T',
          class: 'local',
          type: { definition: 'base-type', value: 'TIME' },
          initialValue: { value: 'T#0s' },
          documentation: 'Elapsed time of ramp',
        },
      ],
      body: `BUSY := RUN ;
IF RUN THEN
  IF T >= TR THEN 
    BUSY := 0;
    XOUT := X1;
  ELSE XOUT := XI + (X1-XI) * TIME_TO_REAL(T)
                            / TIME_TO_REAL(TR);
    T := T + CYCLE;
  END_IF;
ELSE
  XOUT := X0;
  XI := X0;
  T := T#0s;
END_IF;`,
      documentation: 'The RAMP function block is modelled on example given in the standard.',
    },
    {
      name: 'HYSTERESIS',
      type: 'function-block',
      language: 'st',
      variables: [
        {
          name: 'XIN1',
          class: 'input',
          type: { definition: 'base-type', value: 'REAL' },
        },
        {
          name: 'XIN2',
          class: 'input',
          type: { definition: 'base-type', value: 'REAL' },
        },
        {
          name: 'EPS',
          class: 'input',
          type: { definition: 'base-type', value: 'REAL' },
        },
        {
          name: 'Q',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
        },
      ],
      body: `IF Q THEN
  IF XIN1 < (XIN2 - EPS) THEN 
    Q := 0;
  END_IF;
ELSIF XIN1 > (XIN2 + EPS) THEN
  Q := 1;
END_IF;`,
      documentation:
        'The hysteresis function block provides a hysteresis boolean output driven by the difference of two floating point (REAL) inputs XIN1 and XIN2.',
    },
  ],
}

export { AdditionalFunctionBlocks }
