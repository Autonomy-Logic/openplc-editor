import { PLCFunctionBlock } from '@root/types/PLC/open-plc'

const _standardFunctionBlocks: PLCFunctionBlock[] = [
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
        location: 'R location',
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
        location: 'Q1 location',
        documentation: 'Q1 documentation',
        debug: false,
      },
    ],
    body: 'Q1 := S1 OR ((NOT R) AND Q1);',
    documentation: 'The SR bistable is a latch where the Set dominates.',
  },
  {
    name: 'RS',
    language: 'st',
    variables: [
      {
        name: 'S',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'S location',
        documentation: 'S documentation',
        debug: false,
      },
      {
        name: 'R1',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'R1 location',
        documentation: 'R1 documentation',
        debug: false,
      },
      {
        name: 'Q1',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'Q1 location',
        documentation: 'Q1 documentation',
        debug: false,
      },
    ],
    body: 'Q1 := (NOT R1) AND (S OR Q1);',
    documentation: 'The RS bistable is a latch where the Reset dominates.',
  },
  {
    name: 'SEMA',
    language: 'st',
    variables: [
      {
        name: 'CLAIM',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'CLAIM location',
        documentation: 'CLAIM documentation',
        debug: false,
      },
      {
        name: 'RELEASE',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'RELEASE location',
        documentation: 'RELEASE documentation',
        debug: false,
      },
      {
        name: 'BUSY',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'BUSY location',
        documentation: 'BUSY documentation',
        debug: false,
      },
      {
        name: 'Q_INTERNAL',
        class: 'local',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'Q_INTERNAL location',
        documentation: 'Q_INTERNAL documentation',
        debug: false,
      },
    ],
    body: 'Q_INTERNAL := CLAIM OR ( Q_INTERNAL AND (NOT RELEASE));BUSY := Q_INTERNAL; ',
    documentation:
      'The semaphore provides a mechanism to allow software elements mutually exclusive access to certain resources.',
  },
  {
    name: 'R_TRIG',
    language: 'st',
    variables: [
      {
        name: 'CLK',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'CLK location',
        documentation: 'CLK documentation',
        debug: false,
      },
      {
        name: 'Q',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'Q location',
        documentation: 'Q documentation',
        debug: false,
      },
      {
        name: 'M',
        class: 'local',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'M location',
        documentation: 'M documentation',
        debug: false,
      },
    ],
    documentation: 'The output produces a single pulse when a rising edge is detected.',
    body: 'Q := CLK AND NOT M; M := CLK;',
  },
  {
    name: 'F_TRIG',
    language: 'st',
    variables: [
      {
        name: 'CLK',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'CLK location',
        documentation: 'CLK documentation',
        debug: false,
      },
      {
        name: 'Q',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'Q location',
        documentation: 'Q documentation',
        debug: false,
      },
      {
        name: 'M',
        class: 'local',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'M location',
        documentation: 'M documentation',
        debug: false,
      },
    ],
    documentation: 'The output produces a single pulse when a falling edge is detected.',
    body: 'CDATA[Q := NOT CLK AND NOT M; M := NOT CLK;',
  },
  {
    name: 'CTU',
    language: 'st',
    variables: [
      {
        name: 'CU',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'CU location',
        documentation: 'CU documentation',
        debug: false,
      },
      {
        name: 'R',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'R location',
        documentation: 'R documentation',
        debug: false,
      },
      {
        name: 'PV',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'int',
        },
        location: 'PV location',
        documentation: 'PV documentation',
        debug: false,
      },
      {
        name: 'Q',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'Q location',
        documentation: 'Q documentation',
        debug: false,
      },
      {
        name: 'CV',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'lint',
        },
        location: 'CV location',
        documentation: 'CV documentation',
        debug: false,
      },
      {
        name: 'CU_T',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'lint',
        },
        location: 'CV location',
        documentation: 'CV documentation',
        debug: false,
      },
    ],
    documentation:
      'CDATA[CU_T(CU); IF R THEN CV := 0; ELSIF CU_T.Q AND (CV < PV) THEN CV := CV+1; END_IF; Q := (CV >= PV);',
    body: 'The up-counter can be used to signal when a count has reached a maximum value.',
  },
  {
    name: 'CTU_LINT',
    language: 'st',
    variables: [
      {
        name: 'CU',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'CU location',
        documentation: 'CU location',
        debug: false,
      },
      {
        name: 'R',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'R location',
        documentation: 'R location',
        debug: false,
      },
      {
        name: 'PV',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'lint',
        },
        location: 'PV location',
        documentation: 'PV location',
        debug: false,
      },
      {
        name: 'Q',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'Q location',
        documentation: 'Q location',
        debug: false,
      },
      {
        name: 'CV',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'CV location',
        documentation: 'CV location',
        debug: false,
      },
      {
        name: 'CU_T',
        class: 'local',
        /**
         * to do: this should be implemented.
         */
        type: {
          definition: 'base-type',
          value: 'bool',
          // definition: 'derived'
          // value: 'R_TRIG'
        },
        location: 'CV location',
        documentation: 'CV location',
        debug: false,
      },
    ],
    documentation: 'The up-counter can be used to signal when a count has reached a maximum value.',
    body: 'CU_T(CU); IF R THEN CV := 0; ELSIF CU_T.Q AND (CV < PV) THEN CV := CV+1; END_IF; Q := (CV >= PV);',
  },
  {
    name: 'CTU_UDINT',
    language: 'st',
    variables: [
      {
        name: 'CU',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'CU location',
        documentation: 'CU location',
        debug: false,
      },
      {
        name: 'R',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'R location',
        documentation: 'R location',
        debug: false,
      },
      {
        name: 'PV',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'udint',
        },
        location: 'PV location',
        documentation: 'PV location',
        debug: false,
      },
      {
        name: 'Q',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'Q location',
        documentation: 'Q location',
        debug: false,
      },
      {
        name: 'CV',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'udint',
        },
        location: 'CV location',
        documentation: 'CV location',
        debug: false,
      },
      {
        name: 'CU_T',
        class: 'local',
       /**
         * to do: this should be implemented.
         */
       type: {
        definition: 'base-type',
        value: 'bool',
        // definition: 'derived'
        // value: 'R_TRIG'
      },
        location: 'CV location',
        documentation: 'CV location',
        debug: false,
      },
    ],
    documentation: 'The up-counter can be used to signal when a count has reached a maximum value.',
    body: 'CU_T(CU); IF R THEN CV := 0; ELSIF CU_T.Q AND (CV < PV) THEN CV := CV+1; END_IF; Q := (CV >= PV);',
  },
  {
    name: 'CTU_ULINT',
    language: 'st',
    variables: [
      {
        name: 'CV',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'CV location',
        documentation: 'CV location',
        debug: false,
      },
      {
        name: 'R',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'R location',
        documentation: 'R location',
        debug: false,
      },
      {
        name: 'PV',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'ulint',
        },
        location: 'PV location',
        documentation: 'PV location',
        debug: false,
      },
      {
        name: 'Q',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'Q location',
        documentation: 'Q location',
        debug: false,
      },
      {
        name: 'CV',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'ulint',
        },
        location: 'CV location',
        documentation: 'CV location',
        debug: false,
      },
      {
        name: 'CU_T',
        class: 'local',
        /**
         * to do: this should be implemented.
         */
        type: {
          definition: 'base-type',
          value: 'bool',
          // definition: 'derived'
          // value: 'R_TRIG'
        },
        location: 'CV location',
        documentation: 'CV location',
        debug: false,
      },
    ],
    documentation: 'The up-counter can be used to signal when a count has reached a maximum value.',
    body: 'CU_T(CU); IF R THEN CV := 0; ELSIF CU_T.Q AND (CV < PV) THEN CV := CV+1; END_IF; Q := (CV >= PV);',
  },
  {
    name: 'CTD',
    language: 'st',
    variables: [
      {
        name: 'CD',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'CD location',
        documentation: 'CD location',
        debug: false,
      },
      {
        name: 'LD',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'LD location',
        documentation: 'LD location',
        debug: false,
      },
      {
        name: 'PV',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'int',
        },
        location: 'PV location',
        documentation: 'PV location',
        debug: false,
      },
      {
        name: 'Q',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'Q location',
        documentation: 'Q location',
        debug: false,
      },
      {
        name: 'CV',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'int',
        },
        location: 'CV location',
        documentation: 'CV location',
        debug: false,
      },
      {
        name: 'CD_T',
        class: 'local',
       /**
         * to do: this should be implemented.
         */
       type: {
        definition: 'base-type',
        value: 'bool',
        // definition: 'derived'
        // value: 'R_TRIG'
      },
        location: 'CD_T location',
        documentation: 'CD_T location',
        debug: false,
      },
    ],
    documentation: 'CD_T(CD); IF LD THEN CV := PV; ELSIF CD_T.Q AND (CV > 0) THEN CV := CV-1; END_IF; Q := (CV <= 0);',
    body: 'The down-counter can be used to signal when a count has reached zero, on counting down from a preset value.',
  },
  {
    name: 'CTD_DINT',
    language: 'st',
    variables: [
      {
        name: 'CD',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'CD location',
        documentation: 'CD location',
        debug: false,
      },
      {
        name: 'LD',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'LD location',
        documentation: 'LD location',
        debug: false,
      },
      {
        name: 'PV',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'lint',
        },
        location: 'PV location',
        documentation: 'PV location',
        debug: false,
      },
      {
        name: 'Q',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'Q location',
        documentation: 'Q location',
        debug: false,
      },
      {
        name: 'CV',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'lint',
        },
        location: 'CV location',
        documentation: 'CV location',
        debug: false,
      },
      {
        name: 'CD_T',
        class: 'local',
       /**
         * to do: this should be implemented.
         */
       type: {
        definition: 'base-type',
        value: 'bool',
        // definition: 'derived'
        // value: 'R_TRIG'
      },
        location: 'CD_T location',
        documentation: 'CD_T location',
        debug: false,
      },
    ],
    body: 'CDATA[CD_T(CD); IF LD THEN CV := PV; ELSIF CD_T.Q AND (CV > 0) THEN CV := CV-1; END_IF; Q := (CV <= 0);',
    documentation:
      'The down-counter can be used to signal when a count has reached zero, on counting down from a preset value.',
  },
  {
    name: 'CTD_UDINT',
    language: 'st',
    variables: [
      {
        name: 'CD',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'CD location',
        documentation: 'CD location',
        debug: false,
      },
      {
        name: 'LD',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'LD location',
        documentation: 'LD location',
        debug: false,
      },
      {
        name: 'PV',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'udint',
        },
        location: 'PV location',
        documentation: 'PV location',
        debug: false,
      },
      {
        name: 'Q',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'Q location',
        documentation: 'Q location',
        debug: false,
      },
      {
        name: 'CV',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'udint',
        },
        location: 'CV location',
        documentation: 'CV location',
        debug: false,
      },
      {
        name: 'CD_T',
        class: 'local',
        /**
         * to do: this should be implemented.
         */
        type: {
          definition: 'base-type',
          value: 'bool',
          // definition: 'derived'
          // value: 'R_TRIG'
        },
        location: 'CD_T location',
        documentation: 'CD_T location',
        debug: false,
      },
    ],
    body: 'CDATA[CD_T(CD); IF LD THEN CV := PV; ELSIF CD_T.Q AND (CV > 0) THEN CV := CV-1; END_IF; Q := (CV <= 0);',
    documentation:
      'The down-counter can be used to signal when a count has reached zero, on counting down from a preset value.',
  },
  {
    name: 'CTUD',
    language: 'st',
    variables: [
      {
        name: 'CU',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'CU location',
        documentation: 'CU location',
        debug: false,
      },
      {
        name: 'CD',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'CD location',
        documentation: 'CD location',
        debug: false,
      },
      {
        name: 'R',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'R location',
        documentation: 'R location',
        debug: false,
      },
      {
        name: 'LD',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'LD location',
        documentation: 'LD location',
        debug: false,
      },
      {
        name: 'PV',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'int',
        },
        location: 'PV location',
        documentation: 'PV location',
        debug: false,
      },
      {
        name: 'QU',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'int',
        },
        location: 'QU location',
        documentation: 'QU location',
        debug: false,
      },
      {
        name: 'QD',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'QD location',
        documentation: 'QD location',
        debug: false,
      },
      {
        name: 'CV',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'int',
        },
        location: 'CV location',
        documentation: 'CV location',
        debug: false,
      },
      {
        name: 'CD_T',
        class: 'output',
     /**
         * to do: this should be implemented.
         */
     type: {
      definition: 'base-type',
      value: 'bool',
      // definition: 'derived'
      // value: 'R_TRIG'
    },
        location: 'CD_T location',
        documentation: 'CD_T location',
        debug: false,
      },
      {
        name: 'CU_T',
        class: 'output',
      /**
         * to do: this should be implemented.
         */
      type: {
        definition: 'base-type',
        value: 'bool',
        // definition: 'derived'
        // value: 'R_TRIG'
      },
        location: 'CU_T location',
        documentation: 'CU_T location',
        debug: false,
      },
    ],
    body: 'CD_T(CD); CU_T(CU); IF R THEN CV := 0; ELSIF LD THEN CV := PV; ELSE IF NOT (CU_T.Q AND CD_T.Q) THEN IF CU_T.Q AND (CV < PV) THEN CV := CV+1; ELSIF CD_T.Q AND (CV > 0) THEN CV := CV-1; END_IF; END_IF; END_IF; QU := (CV >= PV); QD := (CV <= 0);',
    documentation:
      'The up-down counter has two inputs CU and CD. It can be used to both count up on one input and down on the other.',
  },
  {
    name: 'CTUD_DINT',
    language: 'st',
    variables: [
      {
        name: 'CU',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'CU location',
        documentation: 'CU location',
        debug: false,
      },
      {
        name: 'CD',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'CD location',
        documentation: 'CD location',
        debug: false,
      },
      {
        name: 'R',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'R location',
        documentation: 'R location',
        debug: false,
      },
      {
        name: 'LD',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'LD location',
        documentation: 'LD location',
        debug: false,
      },
      {
        name: 'PV',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'dint',
        },
        location: 'PV location',
        documentation: 'PV location',
        debug: false,
      },
      {
        name: 'QU',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'int',
        },
        location: 'QU location',
        documentation: 'QU location',
        debug: false,
      },
      {
        name: 'QD',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'QD location',
        documentation: 'QD location',
        debug: false,
      },
      {
        name: 'CV',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'dint',
        },
        location: 'CV location',
        documentation: 'CV location',
        debug: false,
      },
      {
        name: 'CD_T',
        class: 'output',
        /**
         * to do: this should be implemented.
         */
        type: {
          definition: 'base-type',
          value: 'bool',
          // definition: 'derived'
          // value: 'R_TRIG'
        },
        location: 'CD_T location',
        documentation: 'CD_T location',
        debug: false,
      },
      {
        name: 'CU_T',
        class: 'output',
       /**
         * to do: this should be implemented.
         */
       type: {
        definition: 'base-type',
        value: 'bool',
        // definition: 'derived'
        // value: 'R_TRIG'
      },
        location: 'CU_T location',
        documentation: 'CU_T location',
        debug: false,
      },
    ],
    documentation:
      'The up-down counter has two inputs CU and CD. It can be used to both count up on one input and down on the other.',
    body: 'CD_T(CD); CU_T(CU); IF R THEN CV := 0; ELSIF LD THEN CV := PV; ELSE IF NOT (CU_T.Q AND CD_T.Q) THEN IF CU_T.Q AND (CV < PV) THEN CV := CV+1; ELSIF CD_T.Q AND (CV > 0) THEN CV := CV-1; END_IF; END_IF; END_IF; QU := (CV >= PV); QD := (CV <= 0);',
  },
  {
    name: 'CTUD_LINT',
    language: 'st',
    variables: [
      {
        name: 'CU',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'CU location',
        documentation: 'CU location',
        debug: false,
      },
      {
        name: 'CD',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'CD location',
        documentation: 'CD location',
        debug: false,
      },
      {
        name: 'R',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'R location',
        documentation: 'R location',
        debug: false,
      },
      {
        name: 'LD',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'LD location',
        documentation: 'LD location',
        debug: false,
      },
      {
        name: 'PV',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'lint',
        },
        location: 'PV location',
        documentation: 'PV location',
        debug: false,
      },
      {
        name: 'QU',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'int',
        },
        location: 'QU location',
        documentation: 'QU location',
        debug: false,
      },
      {
        name: 'QD',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'QD location',
        documentation: 'QD location',
        debug: false,
      },
      {
        name: 'CV',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'lint',
        },
        location: 'CV location',
        documentation: 'CV location',
        debug: false,
      },
      {
        name: 'CD_T',
        class: 'output',
        /**
         * to do: this should be implemented.
         */
        type: {
          definition: 'base-type',
          value: 'bool',
          // definition: 'derived'
          // value: 'R_TRIG'
        },
        location: 'CD_T location',
        documentation: 'CD_T location',
        debug: false,
      },
      {
        name: 'CU_T',
        class: 'output',
      /**
         * to do: this should be implemented.
         */
      type: {
        definition: 'base-type',
        value: 'bool',
        // definition: 'derived'
        // value: 'R_TRIG'
      },
        location: 'CU_T location',
        documentation: 'CU_T location',
        debug: false,
      },
    ],
    documentation:
      'The up-down counter has two inputs CU and CD. It can be used to both count up on one input and down on the other.',
    body: 'CD_T(CD); CU_T(CU); IF R THEN CV := 0; ELSIF LD THEN CV := PV; ELSE IF NOT (CU_T.Q AND CD_T.Q) THEN IF CU_T.Q AND (CV < PV) THEN CV := CV+1; ELSIF CD_T.Q AND (CV > 0) THEN CV := CV-1; END_IF; END_IF; END_IF; QU := (CV >= PV); QD := (CV <= 0);',
  },
  {
    name: 'CTUD_UDINT',
    language: 'st',
    variables: [
      {
        name: 'CU',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'CU location',
        documentation: 'CU location',
        debug: false,
      },
      {
        name: 'CD',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'CD location',
        documentation: 'CD location',
        debug: false,
      },
      {
        name: 'R',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'R location',
        documentation: 'R location',
        debug: false,
      },
      {
        name: 'LD',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'LD location',
        documentation: 'LD location',
        debug: false,
      },
      {
        name: 'PV',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'udint',
        },
        location: 'PV location',
        documentation: 'PV location',
        debug: false,
      },
      {
        name: 'QU',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'int',
        },
        location: 'QU location',
        documentation: 'QU location',
        debug: false,
      },
      {
        name: 'QD',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'QD location',
        documentation: 'QD location',
        debug: false,
      },
      {
        name: 'CV',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'udint',
        },
        location: 'CV location',
        documentation: 'CV location',
        debug: false,
      },
      {
        name: 'CD_T',
        class: 'output',
         /**
         * to do: this should be implemented.
         */
         type: {
          definition: 'base-type',
          value: 'bool',
          // definition: 'derived'
          // value: 'R_TRIG'
        },
        location: 'CD_T location',
        documentation: 'CD_T location',
        debug: false,
      },
      {
        name: 'CU_T',
        class: 'output',
        /**
         * to do: this should be implemented.
         */
        type: {
          definition: 'base-type',
          value: 'bool',
          // definition: 'derived'
          // value: 'R_TRIG'
        },
        location: 'CU_T location',
        documentation: 'CU_T location',
        debug: false,
      },
    ],
    documentation:
      'The up-down counter has two inputs CU and CD. It can be used to both count up on one input and down on the other.',
    body: 'CD_T(CD); CU_T(CU); IF R THEN CV := 0; ELSIF LD THEN CV := PV; ELSE IF NOT (CU_T.Q AND CD_T.Q) THEN IF CU_T.Q AND (CV < PV) THEN CV := CV+1; ELSIF CD_T.Q AND (CV > 0) THEN CV := CV-1; END_IF; END_IF; END_IF; QU := (CV >= PV); QD := (CV <= 0);',
  },
  {
    name: 'CTUD_ULINT',
    language: 'st',
    variables: [
      {
        name: 'CU',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'CU location',
        documentation: 'CU location',
        debug: false,
      },
      {
        name: 'CD',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'CD location',
        documentation: 'CD location',
        debug: false,
      },
      {
        name: 'R',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'R location',
        documentation: 'R location',
        debug: false,
      },
      {
        name: 'LD',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'LD location',
        documentation: 'LD location',
        debug: false,
      },
      {
        name: 'PV',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'ulint',
        },
        location: 'PV location',
        documentation: 'PV location',
        debug: false,
      },
      {
        name: 'QU',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'int',
        },
        location: 'QU location',
        documentation: 'QU location',
        debug: false,
      },
      {
        name: 'QD',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'QD location',
        documentation: 'QD location',
        debug: false,
      },
      {
        name: 'CV',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'ulint',
        },
        location: 'CV location',
        documentation: 'CV location',
        debug: false,
      },
      {
        name: 'CD_T',
        class: 'output',
        /**
         * to do: this should be implemented.
         */
        type: {
          definition: 'base-type',
          value: 'bool',
          // definition: 'derived'
          // value: 'R_TRIG'
        },
        location: 'CD_T location',
        documentation: 'CD_T location',
        debug: false,
      },
      {
        name: 'CU_T',
        class: 'output',
         /**
         * to do: this should be implemented.
         */
         type: {
          definition: 'base-type',
          value: 'bool',
          // definition: 'derived'
          // value: 'R_TRIG'
        },
        location: 'CU_T location',
        documentation: 'CU_T location',
        debug: false,
      },
    ],
    documentation:
      'The up-down counter has two inputs CU and CD. It can be used to both count up on one input and down on the other.',
    body: 'CD_T(CD); CU_T(CU); IF R THEN CV := 0; ELSIF LD THEN CV := PV; ELSE IF NOT (CU_T.Q AND CD_T.Q) THEN IF CU_T.Q AND (CV < PV) THEN CV := CV+1; ELSIF CD_T.Q AND (CV > 0) THEN CV := CV-1; END_IF; END_IF; END_IF; QU := (CV >= PV); QD := (CV <= 0);',
  },
  {
    name: 'TP',
    language: 'st',
    variables: [
      {
        name: 'IN',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'IN location',
        documentation: 'first input parameter',
        debug: false,
      },
      {
        name: 'PT',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'time',
        },
        location: 'PT location',
        documentation: 'second input parameter',
        debug: false,
      },
      {
        name: 'Q',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        /**
         * to do: this should be implemented.
         */
        // initialValue: FALSE
        location: 'Q location',
        documentation: 'first output parameter',
        debug: false,
      },
      {
        name: 'ET',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'time',
        },
            /**
         * to do: this should be implemented.
         */
        // initialValue: T#0s
        location: 'ET location',
        documentation: 'second output parameter',
        debug: false,
      },
      {
        name: 'STATE',
        class: 'local',
        type: {
          definition: 'base-type',
          value: 'sint',
        },
            /**
         * to do: this should be implemented.
         */
        // initialValue: 0
        location: 'ET location',
        documentation: 'internal state: 0-reset, 1-counting, 2-set',
        debug: false,
      },
      {
        name: 'PREV_IN',
        class: 'local',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
            /**
         * to do: this should be implemented.
         */
        // initialValue: FALSE
        location: 'PREV_IN location',
        documentation: 'PREV_IN documentation',
        debug: false,
      },
      {
        name: 'CURRENT_TIME',
        class: 'local',
        type: {
          definition: 'base-type',
          value: 'time',
        },
        location: 'CURRENT_TIME location',
        documentation: 'CURRENT_TIME documentation',
        debug: false,
      },
      {
        name: 'START_TIME',
        class: 'local',
        type: {
          definition: 'base-type',
          value: 'time',
        },
        location: 'START_TIME location',
        documentation: 'START_TIME documentation',
        debug: false,
      },
    ],
    documentation: '{__SET_VAR(data__->, CURRENT_TIME,, __CURRENT_TIME)} IF ((STATE = 0) AND NOT(PREV_IN) AND IN) THEN (* found rising edge on IN *) STATE := 1; Q := TRUE; START_TIME := CURRENT_TIME; ELSIF (STATE = 1) THEN IF ((START_TIME + PT) <= CURRENT_TIME) THEN STATE := 2; Q := FALSE; ET := PT; ELSE ET := CURRENT_TIME - START_TIME; END_IF; END_IF; IF ((STATE = 2) AND NOT(IN)) THEN ET := T#0s; STATE := 0; END_IF; PREV_IN := IN',
    body: '[The pulse timer can be used to generate output pulses of a given time duration.',
  },
  {
    name: 'TON',
    language: 'st',
    variables: [
      {
        name: 'IN',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'IN location',
        documentation: 'first input parameter',
        debug: false,
      },
      {
        name: 'PT',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'time',
        },
        location: 'PT location',
        documentation: 'second input parameter',
        debug: false,
      },
      {
        name: 'Q',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        /**
         * to do: this should be implemented.
         */
        // initialValue: FALSE
        location: 'Q location',
        documentation: 'first output parameter',
        debug: false,
      },
      {
        name: 'ET',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'time',
        },
            /**
         * to do: this should be implemented.
         */
        // initialValue: T#0s
        location: 'ET location',
        documentation: 'second output parameter',
        debug: false,
      },
      {
        name: 'STATE',
        class: 'local',
        type: {
          definition: 'base-type',
          value: 'sint',
        },
            /**
         * to do: this should be implemented.
         */
        // initialValue: 0
        location: 'ET location',
        documentation: 'internal state: 0-reset, 1-counting, 2-set',
        debug: false,
      },
      {
        name: 'PREV_IN',
        class: 'local',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
            /**
         * to do: this should be implemented.
         */
        // initialValue: FALSE
        location: 'PREV_IN location',
        documentation: 'PREV_IN documentation',
        debug: false,
      },
      {
        name: 'CURRENT_TIME',
        class: 'local',
        type: {
          definition: 'base-type',
          value: 'time',
        },
        location: 'CURRENT_TIME location',
        documentation: 'CURRENT_TIME documentation',
        debug: false,
      },
      {
        name: 'START_TIME',
        class: 'local',
        type: {
          definition: 'base-type',
          value: 'time',
        },
        location: 'START_TIME location',
        documentation: 'START_TIME documentation',
        debug: false,
      },
    ],
    documentation: '{__SET_VAR(data__->, CURRENT_TIME,, __CURRENT_TIME)} IF ((STATE = 0) AND NOT(PREV_IN) AND IN) THEN (* found rising edge on IN *) STATE := 1; Q := FALSE; START_TIME := CURRENT_TIME; ELSE (* STATE is 1 or 2 !! *) IF (NOT(IN)) THEN ET := T#0s; Q := FALSE; STATE := 0; ELSIF (STATE = 1) THEN IF ((START_TIME + PT) <= CURRENT_TIME) THEN STATE := 2; Q := TRUE; ET := PT; ELSE ET := CURRENT_TIME - START_TIME; END_IF; END_IF; END_IF; PREV_IN := IN;',
    body: 'The on-delay timer can be used to delay setting an output true, for fixed period after an input becomes true.'
  },
  {
    name: 'TOF',
    language: 'st',
    variables: [
      {
        name: 'IN',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        location: 'IN location',
        documentation: 'first input parameter',
        debug: false,
      },
      {
        name: 'PT',
        class: 'input',
        type: {
          definition: 'base-type',
          value: 'time',
        },
        location: 'PT location',
        documentation: 'second input parameter',
        debug: false,
      },
      {
        name: 'Q',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
        /**
         * to do: this should be implemented.
         */
        // initialValue: FALSE
        location: 'Q location',
        documentation: 'first output parameter',
        debug: false,
      },
      {
        name: 'ET',
        class: 'output',
        type: {
          definition: 'base-type',
          value: 'time',
        },
            /**
         * to do: this should be implemented.
         */
        // initialValue: T#0s
        location: 'ET location',
        documentation: 'second output parameter',
        debug: false,
      },
      {
        name: 'STATE',
        class: 'local',
        type: {
          definition: 'base-type',
          value: 'sint',
        },
            /**
         * to do: this should be implemented.
         */
        // initialValue: 0
        location: 'ET location',
        documentation: 'internal state: 0-reset, 1-counting, 2-set',
        debug: false,
      },
      {
        name: 'PREV_IN',
        class: 'local',
        type: {
          definition: 'base-type',
          value: 'bool',
        },
            /**
         * to do: this should be implemented.
         */
        // initialValue: FALSE
        location: 'PREV_IN location',
        documentation: 'PREV_IN documentation',
        debug: false,
      },
      {
        name: 'CURRENT_TIME',
        class: 'local',
        type: {
          definition: 'base-type',
          value: 'time',
        },
        location: 'CURRENT_TIME location',
        documentation: 'CURRENT_TIME documentation',
        debug: false,
      },
      {
        name: 'START_TIME',
        class: 'local',
        type: {
          definition: 'base-type',
          value: 'time',
        },
        location: 'START_TIME location',
        documentation: 'START_TIME documentation',
        debug: false,
      },
    ],
    documentation: '{__SET_VAR(data__->, CURRENT_TIME,, __CURRENT_TIME)} IF ((STATE = 0) AND NOT(PREV_IN) AND IN) THEN (* found rising edge on IN *) STATE := 1; Q := FALSE; START_TIME := CURRENT_TIME; ELSE (* STATE is 1 or 2 !! *) IF (NOT(IN)) THEN ET := T#0s; Q := FALSE; STATE := 0; ELSIF (STATE = 1) THEN IF ((START_TIME + PT) <= CURRENT_TIME) THEN STATE := 2; Q := TRUE; ET := PT; ELSE ET := CURRENT_TIME - START_TIME; END_IF; END_IF; END_IF; PREV_IN := IN;',
    body: 'The on-delay timer can be used to delay setting an output true, for fixed period after an input becomes true.'
  },
]
