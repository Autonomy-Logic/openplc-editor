import { BaseLibraryPouSchema, BaseLibrarySchema, BaseLibraryVariableSchema, baseTypeSchema } from '@root/types/PLC'
import { z } from 'zod'

const StandardFunctionBlocksVariablesSchema = BaseLibraryVariableSchema.extend({
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
  initialValue: z.lazy((): z.Schema<unknown> => StandardFunctionBlocksVariablesSchema.pick({ type: true })).optional(),
})

const StandardFunctionBlocksPouSchema = BaseLibraryPouSchema.extend({
  variables: z.array(StandardFunctionBlocksVariablesSchema),
})

export const StandardFunctionBlocksLibrarySchema = BaseLibrarySchema.extend({
  pous: z.array(StandardFunctionBlocksPouSchema),
})

type StandardFunctionBlocksLibrary = z.infer<typeof StandardFunctionBlocksLibrarySchema>

const StandardFunctionBlocks: StandardFunctionBlocksLibrary = {
  name: 'Standard Function Blocks',
  version: '1.0.0',
  author: 'Autonomy Logic',
  stPath: 'dummypath/wichwillbereplacedlater',
  cPath: 'dummypath/wichwillbereplacedlater',
  pous: [
    {
      name: 'SR',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'S1', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'R', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'Q1', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
      ],
      body: 'Q1 := S1 OR ((NOT R) AND Q1);',
      documentation: 'The SR bistable is a latch where the Set dominates.',
    },
    {
      name: 'RS',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'S', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'R1', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'Q1', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
      ],
      body: 'Q1 := (NOT R1) AND (S OR Q1);',
      documentation: 'The RS bistable is a latch where the Reset dominates.',
    },
    {
      name: 'SEMA',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'CLAIM', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'RELEASE', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'BUSY', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'Q_INTERNAL', class: 'local', type: { definition: 'base-type', value: 'BOOL' } },
      ],
      body: 'Q_INTERNAL := CLAIM OR ( Q_INTERNAL AND (NOT RELEASE));BUSY := Q_INTERNAL; ',
      documentation:
        'The semaphore provides a mechanism to allow software elements mutually exclusive access to certain resources.',
    },
    {
      name: 'R_TRIG',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'CLK', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'Q', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        // TODO: Verify the "retain" property that appears in the xml definition.
        { name: 'M', class: 'local', type: { definition: 'base-type', value: 'BOOL' } },
      ],
      body: 'Q := CLK AND NOT M; M := CLK;',
      documentation: 'The output produces a single pulse when a rising edge is detected.',
    },
    {
      name: 'F_TRIG',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'CLK', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'Q', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'M', class: 'local', type: { definition: 'base-type', value: 'BOOL' } },
      ],
      body: 'Q := NOT CLK AND NOT M; M := NOT CLK;',
      documentation: 'The output produces a single pulse when a falling edge is detected.',
    },
    {
      name: 'CTU',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'CU', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'R', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'PV', class: 'input', type: { definition: 'base-type', value: 'INT' } },
        { name: 'Q', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'CV', class: 'output', type: { definition: 'base-type', value: 'INT' } },
        { name: 'CU_T', class: 'local', type: { definition: 'derived-type', value: 'R_TRIG' } },
      ],
      body: `CU_T(CU);
        IF R THEN CV := 0;
        ELSIF CU_T.Q AND (CV < PV) THEN CV := CV+1;
        END_IF;
        Q := (CV >= PV);`,
      documentation: 'The up-counter can be used to signal when a count has reached a maximum value.',
    },
    {
      name: 'CTU_DINT',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'CU', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'R', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'PV', class: 'input', type: { definition: 'base-type', value: 'DINT' } },
        { name: 'Q', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'CV', class: 'output', type: { definition: 'base-type', value: 'DINT' } },
        { name: 'CU_T', class: 'local', type: { definition: 'derived-type', value: 'R_TRIG' } },
      ],
      body: `CU_T(CU);
        IF R THEN CV := 0;
        ELSIF CU_T.Q AND (CV < PV) THEN CV := CV+1;
        END_IF;
        Q := (CV >= PV);`,
      documentation: 'The up-counter can be used to signal when a count has reached a maximum value.',
    },
    {
      name: 'CTU_LINT',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'CU', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'R', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'PV', class: 'input', type: { definition: 'base-type', value: 'LINT' } },
        { name: 'Q', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'CV', class: 'output', type: { definition: 'base-type', value: 'LINT' } },
        { name: 'CU_T', class: 'local', type: { definition: 'derived-type', value: 'R_TRIG' } },
      ],
      body: `CU_T(CU);
        IF R THEN CV := 0;
        ELSIF CU_T.Q AND (CV < PV) THEN CV := CV+1;
        END_IF;
        Q := (CV >= PV);`,
      documentation: 'The up-counter can be used to signal when a count has reached a maximum value.',
    },
    {
      name: 'CTU_UDINT',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'CU', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'R', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'PV', class: 'input', type: { definition: 'base-type', value: 'UDINT' } },
        { name: 'Q', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'CV', class: 'output', type: { definition: 'base-type', value: 'UDINT' } },
        { name: 'CU_T', class: 'local', type: { definition: 'derived-type', value: 'R_TRIG' } },
      ],
      body: `CU_T(CU);
        IF R THEN CV := 0;
        ELSIF CU_T.Q AND (CV < PV) THEN CV := CV+1;
        END_IF;
        Q := (CV >= PV);`,
      documentation: 'The up-counter can be used to signal when a count has reached a maximum value.',
    },
    {
      name: 'CTU_ULINT',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'CU', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'R', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'PV', class: 'input', type: { definition: 'base-type', value: 'ULINT' } },
        { name: 'Q', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'CV', class: 'output', type: { definition: 'base-type', value: 'ULINT' } },
        { name: 'CU_T', class: 'local', type: { definition: 'derived-type', value: 'R_TRIG' } },
      ],
      body: `CU_T(CU);
        IF R THEN CV := 0;
        ELSIF CU_T.Q AND (CV < PV) THEN CV := CV+1;
        END_IF;
        Q := (CV >= PV);`,
      documentation: 'The up-counter can be used to signal when a count has reached a maximum value.',
    },
    {
      name: 'CTD',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'CD', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'LD', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'PV', class: 'input', type: { definition: 'base-type', value: 'INT' } },
        { name: 'Q', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'CV', class: 'output', type: { definition: 'base-type', value: 'INT' } },
        { name: 'CD_T', class: 'local', type: { definition: 'derived-type', value: 'R_TRIG' } },
      ],
      body: `CD_T(CD);
        IF LD THEN CV := PV;
        ELSIF CD_T.Q AND (CV > 0) THEN CV := CV-1;
        END_IF;
        Q := (CV <= 0);`,
      documentation:
        'The down-counter can be used to signal when a count has reached zero, on counting down from a preset value.',
    },
    {
      name: 'CTD_DINT',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'CD', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'LD', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'PV', class: 'input', type: { definition: 'base-type', value: 'DINT' } },
        { name: 'Q', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'CV', class: 'output', type: { definition: 'base-type', value: 'DINT' } },
        { name: 'CD_T', class: 'local', type: { definition: 'derived-type', value: 'R_TRIG' } },
      ],
      body: `CD_T(CD);
        IF LD THEN CV := PV;
        ELSIF CD_T.Q AND (CV > 0) THEN CV := CV-1;
        END_IF;
        Q := (CV <= 0);`,
      documentation:
        'The down-counter can be used to signal when a count has reached zero, on counting down from a preset value.',
    },
    {
      name: 'CTD_LINT',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'CD', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'LD', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'PV', class: 'input', type: { definition: 'base-type', value: 'LINT' } },
        { name: 'Q', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'CV', class: 'output', type: { definition: 'base-type', value: 'LINT' } },
        { name: 'CD_T', class: 'local', type: { definition: 'derived-type', value: 'R_TRIG' } },
      ],
      body: `CD_T(CD);
        IF LD THEN CV := PV;
        ELSIF CD_T.Q AND (CV > 0) THEN CV := CV-1;
        END_IF;
        Q := (CV <= 0);`,
      documentation:
        'The down-counter can be used to signal when a count has reached zero, on counting down from a preset value.',
    },
    {
      name: 'CTD_UDINT',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'CD', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'LD', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'PV', class: 'input', type: { definition: 'base-type', value: 'UDINT' } },
        { name: 'Q', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'CV', class: 'output', type: { definition: 'base-type', value: 'UDINT' } },
        { name: 'CD_T', class: 'local', type: { definition: 'derived-type', value: 'R_TRIG' } },
      ],
      body: `CD_T(CD);
        IF LD THEN CV := PV;
        ELSIF CD_T.Q AND (CV > 0) THEN CV := CV-1;
        END_IF;
        Q := (CV <= 0);`,
      documentation:
        'The down-counter can be used to signal when a count has reached zero, on counting down from a preset value.',
    },
    {
      name: 'CTD_ULINT',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'CD', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'LD', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'PV', class: 'input', type: { definition: 'base-type', value: 'ULINT' } },
        { name: 'Q', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'CV', class: 'output', type: { definition: 'base-type', value: 'ULINT' } },
        { name: 'CD_T', class: 'local', type: { definition: 'derived-type', value: 'R_TRIG' } },
      ],
      body: `CD_T(CD);
        IF LD THEN CV := PV;
        ELSIF CD_T.Q AND (CV > 0) THEN CV := CV-1;
        END_IF;
        Q := (CV <= 0);`,
      documentation:
        'The down-counter can be used to signal when a count has reached zero, on counting down from a preset value.',
    },
    {
      name: 'CTUD',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'CU', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'CD', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'R', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'LD', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'PV', class: 'input', type: { definition: 'base-type', value: 'INT' } },
        { name: 'QU', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'QD', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'CV', class: 'output', type: { definition: 'base-type', value: 'INT' } },
        { name: 'CD_T', class: 'output', type: { definition: 'derived-type', value: 'R_TRIG' } },
        { name: 'CU_T', class: 'output', type: { definition: 'derived-type', value: 'R_TRIG' } },
      ],
      body: `CD_T(CD);
        CU_T(CU);
        IF R THEN CV := 0;
        ELSIF LD THEN CV := PV;
        ELSE
          IF NOT (CU_T.Q AND CD_T.Q) THEN
            IF CU_T.Q AND (CV < PV)
            THEN CV := CV+1;
            ELSIF CD_T.Q AND (CV > 0)
            THEN CV := CV-1;
            END_IF;
          END_IF;
        END_IF;
        QU := (CV >= PV);
        QD := (CV <= 0);`,
      documentation:
        'The up-down counter has two inputs CU and CD. It can be used to both count up on one input and down on the other.',
    },
    {
      name: 'CTUD_DINT',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'CU', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'CD', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'R', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'LD', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'PV', class: 'input', type: { definition: 'base-type', value: 'DINT' } },
        { name: 'QU', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'QD', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'CV', class: 'output', type: { definition: 'base-type', value: 'DINT' } },
        { name: 'CD_T', class: 'output', type: { definition: 'derived-type', value: 'R_TRIG' } },
        { name: 'CU_T', class: 'output', type: { definition: 'derived-type', value: 'R_TRIG' } },
      ],
      body: `CD_T(CD);
        CU_T(CU);
        IF R THEN CV := 0;
        ELSIF LD THEN CV := PV;
        ELSE
          IF NOT (CU_T.Q AND CD_T.Q) THEN
            IF CU_T.Q AND (CV < PV)
            THEN CV := CV+1;
            ELSIF CD_T.Q AND (CV > 0)
            THEN CV := CV-1;
            END_IF;
          END_IF;
        END_IF;
        QU := (CV >= PV);
        QD := (CV <= 0);`,
      documentation:
        'The up-down counter has two inputs CU and CD. It can be used to both count up on one input and down on the other.',
    },
    {
      name: 'CTUD_LINT',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'CU', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'CD', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'R', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'LD', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'PV', class: 'input', type: { definition: 'base-type', value: 'LINT' } },
        { name: 'QU', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'QD', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'CV', class: 'output', type: { definition: 'base-type', value: 'LINT' } },
        { name: 'CD_T', class: 'output', type: { definition: 'derived-type', value: 'R_TRIG' } },
        { name: 'CU_T', class: 'output', type: { definition: 'derived-type', value: 'R_TRIG' } },
      ],
      body: `CD_T(CD);
        CU_T(CU);
        IF R THEN CV := 0;
        ELSIF LD THEN CV := PV;
        ELSE
          IF NOT (CU_T.Q AND CD_T.Q) THEN
            IF CU_T.Q AND (CV < PV)
            THEN CV := CV+1;
            ELSIF CD_T.Q AND (CV > 0)
            THEN CV := CV-1;
            END_IF;
          END_IF;
        END_IF;
        QU := (CV >= PV);
        QD := (CV <= 0);`,
      documentation:
        'The up-down counter has two inputs CU and CD. It can be used to both count up on one input and down on the other.',
    },
    {
      name: 'CTUD_UDINT',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'CU', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'CD', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'R', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'LD', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'PV', class: 'input', type: { definition: 'base-type', value: 'UDINT' } },
        { name: 'QU', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'QD', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'CV', class: 'output', type: { definition: 'base-type', value: 'UDINT' } },
        { name: 'CD_T', class: 'output', type: { definition: 'derived-type', value: 'R_TRIG' } },
        { name: 'CU_T', class: 'output', type: { definition: 'derived-type', value: 'R_TRIG' } },
      ],
      body: `CD_T(CD);
        CU_T(CU);
        IF R THEN CV := 0;
        ELSIF LD THEN CV := PV;
        ELSE
          IF NOT (CU_T.Q AND CD_T.Q) THEN
            IF CU_T.Q AND (CV < PV)
            THEN CV := CV+1;
            ELSIF CD_T.Q AND (CV > 0)
            THEN CV := CV-1;
            END_IF;
          END_IF;
        END_IF;
        QU := (CV >= PV);
        QD := (CV <= 0);`,
      documentation:
        'The up-down counter has two inputs CU and CD. It can be used to both count up on one input and down on the other.',
    },
    {
      name: 'CTUD_ULINT',
      type: 'function-block',
      language: 'st',
      variables: [
        { name: 'CU', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'CD', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'R', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'LD', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'PV', class: 'input', type: { definition: 'base-type', value: 'ULINT' } },
        { name: 'QU', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'QD', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'CV', class: 'output', type: { definition: 'base-type', value: 'ULINT' } },
        { name: 'CD_T', class: 'output', type: { definition: 'derived-type', value: 'R_TRIG' } },
        { name: 'CU_T', class: 'output', type: { definition: 'derived-type', value: 'R_TRIG' } },
      ],
      body: `CD_T(CD);
        CU_T(CU);
        IF R THEN CV := 0;
        ELSIF LD THEN CV := PV;
        ELSE
          IF NOT (CU_T.Q AND CD_T.Q) THEN
            IF CU_T.Q AND (CV < PV)
            THEN CV := CV+1;
            ELSIF CD_T.Q AND (CV > 0)
            THEN CV := CV-1;
            END_IF;
          END_IF;
        END_IF;
        QU := (CV >= PV);
        QD := (CV <= 0);`,
      documentation:
        'The up-down counter has two inputs CU and CD. It can be used to both count up on one input and down on the other.',
    },
    {
      name: 'TP',
      type: 'function-block',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
          documentation: 'first input parameter',
        },
        {
          name: 'PT',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
          documentation: 'second input parameter',
        },
        {
          name: 'Q',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
          initialValue: { value: 'FALSE' },
          documentation: 'first output parameter',
        },
        {
          name: 'ET',
          class: 'output',
          type: { definition: 'base-type', value: 'TIME' },
          initialValue: { value: 'T#0s' },
          documentation: 'second output parameter',
        },
        {
          name: 'STATE',
          class: 'local',
          type: { definition: 'base-type', value: 'SINT' },
          initialValue: { value: '0' },
          documentation: 'internal state: 0-reset, 1-counting, 2-set',
        },
        {
          name: 'PREV_IN',
          class: 'local',
          type: { definition: 'base-type', value: 'BOOL' },
          initialValue: { value: 'FALSE' },
        },
        { name: 'CURRENT_TIME', class: 'local', type: { definition: 'base-type', value: 'TIME' } },
        { name: 'START_TIME', class: 'local', type: { definition: 'base-type', value: 'TIME' } },
      ],
      body: `{__SET_VAR(data__->,CURRENT_TIME,,__CURRENT_TIME)}

        IF ((STATE = 0) AND NOT(PREV_IN) AND IN)   (* found rising edge on IN *)
        THEN
          (* start timer... *)
          STATE := 1;
          Q := TRUE;
          START_TIME := CURRENT_TIME;

        ELSIF (STATE = 1)
        THEN
          IF ((START_TIME + PT) <= CURRENT_TIME)
          THEN
            STATE := 2;
            Q := FALSE;
            ET := PT;
          ELSE
            ET := CURRENT_TIME - START_TIME;
          END_IF;
        END_IF;

        IF ((STATE = 2) AND NOT(IN))
        THEN
          ET := T#0s;
          STATE := 0;
        END_IF;

        PREV_IN := IN;`,
      documentation: 'The pulse timer can be used to generate output pulses of a given time duration.',
    },
    {
      name: 'TON',
      type: 'function-block',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
          documentation: 'first input parameter',
        },
        {
          name: 'PT',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
          documentation: 'second input parameter',
        },
        {
          name: 'Q',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
          initialValue: { value: 'FALSE' },
          documentation: 'first output parameter',
        },
        {
          name: 'ET',
          class: 'output',
          type: { definition: 'base-type', value: 'TIME' },
          initialValue: { value: 'T#0s' },
          documentation: 'second output parameter',
        },
        {
          name: 'STATE',
          class: 'local',
          type: { definition: 'base-type', value: 'SINT' },
          initialValue: { value: '0' },
          documentation: 'internal state: 0-reset, 1-counting, 2-set',
        },
        {
          name: 'PREV_IN',
          class: 'local',
          type: { definition: 'base-type', value: 'BOOL' },
          initialValue: { value: 'FALSE' },
        },
        { name: 'CURRENT_TIME', class: 'local', type: { definition: 'base-type', value: 'TIME' } },
        { name: 'START_TIME', class: 'local', type: { definition: 'base-type', value: 'TIME' } },
      ],
      body: `{__SET_VAR(data__->,CURRENT_TIME,,__CURRENT_TIME)}

      IF ((STATE = 0) AND NOT(PREV_IN) AND IN)   (* found rising edge on IN *)
      THEN
        (* start timer... *)
        STATE := 1;
        Q := TRUE;
        START_TIME := CURRENT_TIME;

      ELSE
        (* STATE is 1 or 2 !! *)
        IF (NOT(IN))
        THEN
          ET := T#0s;
          Q := FALSE;
          STATE := 0;

        ELSIF (STATE = 1)
        THEN
          IF ((START_TIME + PT) <= CURRENT_TIME)
          THEN
            STATE := 2;
            Q := TRUE;
            ET := PT;
          ELSE
            ET := CURRENT_TIME - START_TIME;
          END_IF;
        END_IF;

      END_IF;

      PREV_IN := IN;`,
      documentation:
        'The on-delay timer can be used to delay setting an output true, for fixed period after an input becomes true.',
    },
    {
      name: 'TOF',
      type: 'function-block',
      language: 'st',
      variables: [
        {
          name: 'IN',
          class: 'input',
          type: { definition: 'base-type', value: 'BOOL' },
          documentation: 'first input parameter',
        },
        {
          name: 'PT',
          class: 'input',
          type: { definition: 'base-type', value: 'TIME' },
          documentation: 'second input parameter',
        },
        {
          name: 'Q',
          class: 'output',
          type: { definition: 'base-type', value: 'BOOL' },
          initialValue: { value: 'FALSE' },
          documentation: 'first output parameter',
        },
        {
          name: 'ET',
          class: 'output',
          type: { definition: 'base-type', value: 'TIME' },
          initialValue: { value: 'T#0s' },
          documentation: 'second output parameter',
        },
        {
          name: 'STATE',
          class: 'local',
          type: { definition: 'base-type', value: 'SINT' },
          initialValue: { value: '0' },
          documentation: 'internal state: 0-reset, 1-counting, 2-set',
        },
        {
          name: 'PREV_IN',
          class: 'local',
          type: { definition: 'base-type', value: 'BOOL' },
          initialValue: { value: 'FALSE' },
        },
        { name: 'CURRENT_TIME', class: 'local', type: { definition: 'base-type', value: 'TIME' } },
        { name: 'START_TIME', class: 'local', type: { definition: 'base-type', value: 'TIME' } },
      ],
      body: `{__SET_VAR(data__->,CURRENT_TIME,,__CURRENT_TIME)}

      IF ((STATE = 0) AND PREV_IN AND NOT(IN))   (* found falling edge on IN *)
      THEN
        (* start timer... *)
        STATE := 1;
        START_TIME := CURRENT_TIME;

      ELSE
        (* STATE is 1 or 2 !! *)
        IF (IN)
        THEN
          ET := T#0s;
          STATE := 0;

        ELSIF (STATE = 1)
        THEN
          IF ((START_TIME + PT) <= CURRENT_TIME)
          THEN
            STATE := 2;
            ET := PT;
          ELSE
            ET := CURRENT_TIME - START_TIME;
          END_IF;
        END_IF;

      END_IF;

      Q := IN OR (STATE = 1);
      PREV_IN := IN;`,
      documentation:
        'The off-delay timer can be used to delay setting an output false, for fixed period after input goes false.',
    },
  ],
}

export { StandardFunctionBlocks }
