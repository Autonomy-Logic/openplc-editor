/* eslint-disable no-useless-escape */
import { PLCDataType, PLCEnumeratedDatatype, PLCStructureDatatype } from '@root/types/PLC/open-plc'
import { languages } from 'monaco-editor'

// Optimized regex based on tmlanguage rules
const symbols = /[=><~?:+\-*^%&|.;/]+/
const escapes = /\$[$'"NLRT]|\$[0-9A-Fa-f]{2}/
const timeLiterals = /[TDTODD]#[0-9:\-_shmydSMHDY]+/
const dateLiterals = /D#[0-9\-]+|DT#[0-9\-_:]+|TOD#[0-9:]+/
const bitLiterals = /[XBWDL]#[0-9A-Fa-f_]+|%[IQM][XBWDL]?[0-9.]+/
const gxwDevices = /\b[MTCRSDXYZ][0-9]{1,5}(?:[ZV][0-9])?\b/
const identifiers = /[a-zA-Z_][a-zA-Z0-9_]*/

// Standard Function Block variables that should be highlighted
const standardFBVariables = [
  // Timer variables
  'IN',
  'PT',
  'Q',
  'ET',
  // Counter variables
  'CU',
  'CD',
  'RESET',
  'LOAD',
  'PV',
  'CV',
  'QU',
  'QD',
  // Trigger variables
  'CLK',
  'M',
  // Bistable variables
  'S',
  'R',
  'S1',
  'R1',
  'Q1',
  // Common FB outputs
  'OUT',
  'ERROR',
  'STATUS',
  'DONE',
  'BUSY',
  // Common FB inputs
  'ENABLE',
  'START',
  'STOP',
  'EXECUTE',
]

// Dynamic DataType variables (will be populated at runtime)
const customDataTypeVariables: string[] = []
const customEnumValueKeywords: string[] = []

export const conf: languages.LanguageConfiguration = {
  comments: {
    lineComment: '//',
    blockComment: ['(*', '*)'],
  },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '(*', close: '*)', notIn: ['string', 'comment'] },
    // { open: '"', close: '"', notIn: ["string"] }, WSTRING not supported yet
    { open: "'", close: "'", notIn: ['string'] },
    { open: '/*', close: '*/', notIn: ['string', 'comment'] },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    // { open: '"', close: '"' }, WSTRING not supported yet
    { open: "'", close: "'" },
  ],
  wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/,
  indentationRules: {
    increaseIndentPattern: /^\s*(IF|FOR|WHILE|REPEAT|CASE|FUNCTION|FUNCTION_BLOCK|PROGRAM|VAR|STRUCT|CLASS|METHOD)\b/i,
    decreaseIndentPattern:
      /^\s*(END_IF|END_FOR|END_WHILE|END_REPEAT|END_CASE|END_FUNCTION|END_FUNCTION_BLOCK|END_PROGRAM|END_VAR|END_STRUCT|END_CLASS|END_METHOD)\b/i,
  },
}

export const language: languages.IMonarchLanguage = {
  ignoreCase: true,
  defaultToken: 'invalid',
  tokenPostfix: '.st',
  localVariables: [],
  standardFBVariables, // Add FB variables to the language definition
  customDataTypeVariables, // Dynamic variables for custom data types

  keywords: [
    // Structural declarations
    'PROGRAM',
    'BEGIN',
    'END',
    'END_PROGRAM',
    'FUNCTION',
    'END_FUNCTION',
    'FUNCTION_BLOCK',
    'END_FUNCTION_BLOCK',
    'METHOD',
    'END_METHOD',
    'CLASS',
    'END_CLASS',
    'INTERFACE',
    'END_INTERFACE',
    'NAMESPACE',
    'END_NAMESPACE',
    'CONFIGURATION',
    'END_CONFIGURATION',
    'RESOURCE',
    'END_RESOURCE',
    'TASK',
    'TYPE',
    'END_TYPE',

    // Variable declarations
    'VAR',
    'VAR_INPUT',
    'VAR_OUTPUT',
    'VAR_IN_OUT',
    'VAR_TEMP',
    'VAR_GLOBAL',
    'VAR_ACCESS',
    'VAR_EXTERNAL',
    'VAR_INST',
    'VAR_STAT',
    'VAR_CONFIG',
    'END_VAR',

    // Data structures
    'STRUCT',
    'END_STRUCT',
    'UNION',
    'END_UNION',
    'ARRAY',
    'ENUM',
    'END_ENUM',
    'PROPERTY',
    'END_PROPERTY',
    'CONST',
    'RETAIN',
    'PERSISTENT',
    'NON_RETAIN',

    // Control flow
    'IF',
    'THEN',
    'ELSE',
    'ELSIF',
    'END_IF',
    'CASE',
    'OF',
    'END_CASE',
    'FOR',
    'TO',
    'BY',
    'DO',
    'END_FOR',
    'WHILE',
    'END_WHILE',
    'REPEAT',
    'UNTIL',
    'END_REPEAT',
    'EXIT',
    'RETURN',
    'CONTINUE',
    'GOTO',
    'LABEL',

    // Primitive types
    'BOOL',
    'SINT',
    'INT',
    'DINT',
    'LINT',
    'USINT',
    'UINT',
    'UDINT',
    'ULINT',
    'BYTE',
    'WORD',
    'DWORD',
    'LWORD',
    'REAL',
    'LREAL',
    'TIME',
    'DATE',
    'TIME_OF_DAY',
    'TOD',
    'DATE_AND_TIME',
    'DT',
    'STRING',
    'WSTRING',
    'CHAR',
    'WCHAR',

    // Special types
    'ANY',
    'ANY_DERIVED',
    'ANY_ELEMENTARY',
    'ANY_MAGNITUDE',
    'ANY_NUM',
    'ANY_REAL',
    'ANY_INT',
    'ANY_BIT',
    'ANY_STRING',
    'ANY_DATE',
    'POINTER',
    'REF',
    'REF_TO',

    // Access modifiers
    'PUBLIC',
    'PRIVATE',
    'PROTECTED',
    'INTERNAL',
    'ABSTRACT',
    'FINAL',
    'OVERRIDE',
    'VIRTUAL',
    'STATIC',
    'EXTENDS',
    'IMPLEMENTS',
    'THIS',
    'SUPER',

    // Constants and literals
    'TRUE',
    'FALSE',
    'NULL',
    'VOID',

    // Logical operators as words
    'AND',
    'OR',
    'NOT',
    'XOR',
    'MOD',
    'AND_THEN',
    'OR_ELSE',

    // Actions and steps (SFC)
    'ACTION',
    'END_ACTION',
    'STEP',
    'END_STEP',
    'INITIAL_STEP',
    'TRANSITION',
    'END_TRANSITION',
    'FROM',
    'TO',
    'WITH',
    'USING',

    // Attributes and directives
    'AT',
    'CONSTANT',
    'OVERLAP',
    'GET',
    'SET',

    // Standard function blocks
    'TON',
    'TOF',
    'TP',
    'CTU',
    'CTD',
    'CTUD',
    'R_TRIG',
    'F_TRIG',
    'RS',
    'SR',
  ],

  operators: [
    // Assignment and comparison
    ':=',
    '=',
    '<>',
    '<=',
    '>=',
    '<',
    '>',
    '=>',
    // Arithmetic
    '+',
    '-',
    '*',
    '/',
    '**',
    'MOD',
    // Logical
    '&',
    'AND',
    '|',
    'OR',
    'XOR',
    'NOT',
    // Bit shift
    'SHL',
    'SHR',
    'ROL',
    'ROR',
    // Range
    '..',
    // Others
    '^',
    '?',
    ':',
    '.',
  ],

  builtinFunctions: [
    // Mathematical
    'ABS',
    'SQRT',
    'EXP',
    'EXPT',
    'LN',
    'LOG',
    'SIN',
    'COS',
    'TAN',
    'ASIN',
    'ACOS',
    'ATAN',
    'CEIL',
    'FLOOR',
    'ROUND',
    'TRUNC',
    'FRAC',
    'MAX',
    'MIN',
    'LIMIT',
    'MUX',
    'SEL',

    // Type conversion
    'BOOL_TO_BYTE',
    'BOOL_TO_WORD',
    'BOOL_TO_DWORD',
    'BOOL_TO_LWORD',
    'BYTE_TO_BOOL',
    'BYTE_TO_WORD',
    'BYTE_TO_DWORD',
    'BYTE_TO_LWORD',
    'WORD_TO_BOOL',
    'WORD_TO_BYTE',
    'WORD_TO_DWORD',
    'WORD_TO_LWORD',
    'DWORD_TO_BOOL',
    'DWORD_TO_BYTE',
    'DWORD_TO_WORD',
    'DWORD_TO_LWORD',
    'LWORD_TO_BOOL',
    'LWORD_TO_BYTE',
    'LWORD_TO_WORD',
    'LWORD_TO_DWORD',
    'INT_TO_REAL',
    'REAL_TO_INT',
    'DINT_TO_REAL',
    'REAL_TO_DINT',
    'STRING_TO_INT',
    'INT_TO_STRING',
    'REAL_TO_STRING',
    'STRING_TO_REAL',
    'TIME_TO_DINT',
    'DINT_TO_TIME',
    'DATE_TO_DINT',
    'DINT_TO_DATE',

    // String functions
    'CONCAT',
    'DELETE',
    'FIND',
    'INSERT',
    'LEFT',
    'LEN',
    'MID',
    'REPLACE',
    'RIGHT',
    'UPPER_CASE',
    'LOWER_CASE',
    'TRIM',

    // Bit manipulation
    'SHL',
    'SHR',
    'ROL',
    'ROR',
    'AND',
    'OR',
    'XOR',
    'NOT',

    // Memory and pointers
    'ADR',
    'SIZEOF',
    'REF',
    'DREF',
    'MOVE',
    'FILL',

    // System functions
    'NOW',
    'TIME',
    'RTC',
    'SEMA',
    '__NEW',
    '__DELETE',
  ],

  // Regex definitions
  symbols,
  escapes,
  timeLiterals,
  dateLiterals,
  bitLiterals,
  gxwDevices,
  identifiers,

  tokenizer: {
    root: [
      // Special comments with tags (must come first)
      [/\/\/\s*(TODO|FIXME|HACK|NOTE|BUG):?.*$/, 'comment.doc'],
      [/\(\*\s*(TODO|FIXME|HACK|NOTE|BUG):?/, { token: 'comment.doc', next: '@commentBlockDoc' }],
      [/\/\*\s*(TODO|FIXME|HACK|NOTE|BUG):?/, { token: 'comment.doc', next: '@commentBlockCDoc' }],

      // Normal comments
      [/\/\/.*$/, 'comment'],
      [/\(\*/, { token: 'comment', next: '@commentBlock' }],
      [/\/\*/, { token: 'comment', next: '@commentBlockC' }],

      // Attributes
      [/\{/, { token: 'delimiter.curly', next: '@attribute' }],

      // Normal strings
      // [/"/, { token: 'string.quote', next: '@stringDouble' }], WSTRING not supported yet
      [/'/, { token: 'string.quote', next: '@stringSingle' }],

      // Typed number literals
      [
        /\b(BYTE|WORD|DWORD|LWORD|SINT|USINT|INT|UINT|DINT|UDINT|LINT|ULINT|REAL|LREAL)#/,
        { token: 'type', next: '@typedNumber' },
      ],

      // Number literals
      [/\b2#[01_]+\b/, 'number.binary'],
      [/\b8#[0-7_]+\b/, 'number.octal'],
      [/\b16#[0-9A-Fa-f_]+\b/, 'number.hex'],
      [/\b[0-9_]+\.[0-9_]+([eE][-+]?[0-9_]+)?\b/, 'number.float'],
      [/\b[0-9_]+([eE][-+]?[0-9_]+)?\b/, 'number'],

      // Time literals
      [timeLiterals, 'number.time'],
      [dateLiterals, 'number.date'],

      // Special hardware variables
      [bitLiterals, 'variable.predefined'],
      [gxwDevices, 'variable.predefined'],

      // Labels
      [/^[a-zA-Z_][a-zA-Z0-9_]*:/, 'type.identifier'],

      // Function calls (before FB variable access) - last group has negative lookahead to not collide with (**) comments
      [/([a-zA-Z_][a-zA-Z0-9_]*)(\s*)(\((?!\*))/, ['keyword', 'white', 'delimiter.parenthesis']],

      // Keywords and identifiers (MOVED BEFORE FB Variable access)
      [
        /[a-zA-Z_][a-zA-Z0-9_]*/,
        {
          cases: {
            '@localVariables': 'keyword',
            '@keywords': 'st.keyword',
            '@builtinFunctions': 'keyword',
            '@operators': 'operator',
            '@standardFBVariables': 'keyword',
            '@customDataTypeVariables': 'keyword',
            'TRUE|FALSE': 'constant.language',
            '@default': 'variable',
          },
        },
      ],

      // Member access (single dot)
      [/\./, 'delimiter.accessor'],

      // Special assignment operators
      [/:=/, 'operator.assignment'],
      [/=>/, 'operator.arrow'],
      [/\.\./, 'operator.range'],

      // Other operators
      [
        symbols,
        {
          cases: {
            '@operators': 'operator',
            '@default': 'delimiter',
          },
        },
      ],

      // Delimiters
      [/[;,]/, 'delimiter'],
      [/[{}()\[\]]/, '@brackets'],

      // Whitespace
      { include: '@whitespace' },
    ],

    typedNumber: [
      [/2#[01_]+/, { token: 'number.binary', next: '@pop' }],
      [/8#[0-7_]+/, { token: 'number.octal', next: '@pop' }],
      [/16#[0-9A-Fa-f_]+/, { token: 'number.hex', next: '@pop' }],
      [/-?[0-9_]+\.[0-9_]+([eE][-+]?[0-9_]+)?/, { token: 'number.float', next: '@pop' }],
      [/-?[0-9_]+/, { token: 'number', next: '@pop' }],
      ['', '', '@pop'], // fallback
    ],

    attribute: [
      [/\}/, { token: 'delimiter.curly', next: '@pop' }],
      [/[a-zA-Z_][a-zA-Z0-9_]*/, 'keyword.attribute'],
      [/:=/, 'operator.assignment'],
      [/"([^"\\]|\\.)*"/, 'string'],
      [/'([^'\\]|\\.)*'/, 'string'],
      [/[0-9]+/, 'number'],
      [/[,;]/, 'delimiter'],
      { include: '@whitespace' },
    ],

    commentBlock: [
      [/\*\)/, 'comment', '@pop'],
      [/./, 'comment'],
    ],

    commentBlockC: [
      [/\*\//, 'comment', '@pop'],
      [/./, 'comment'],
    ],

    commentBlockDoc: [
      [/\*\)/, 'comment.doc', '@pop'],
      [/@\w+/, 'comment.doc.tag'],
      [/./, 'comment.doc'],
    ],

    commentBlockCDoc: [
      [/\*\//, 'comment.doc', '@pop'],
      [/@\w+/, 'comment.doc.tag'],
      [/./, 'comment.doc'],
    ],

    // stringDouble: [ WSTRING not supported yet
    //   [/[^"$]+/, 'string'],
    //   [escapes, 'string.escape'],
    //   [/\$./, 'string.escape.invalid'],
    //   [/"/, { token: 'string.quote', next: '@pop' }],
    // ],

    stringSingle: [
      [/[^'$]+/, 'string'],
      [escapes, 'string.escape'],
      [/\$./, 'string.escape.invalid'],
      [/'/, { token: 'string.quote', next: '@pop' }],
    ],

    whitespace: [
      [/[ \t\r\n]+/, 'white'],
      [/^\s*$/, 'white'],
    ],
  },
}

// Update local variables in the tokenizer
export const updateLocalVariablesInTokenizer = (localVariables: string[]) => {
  language.localVariables = localVariables

  void import('monaco-editor').then((monaco) => {
    monaco.languages.setMonarchTokensProvider('st', language)
  })
}

export const updateDataTypeVariablesInTokenizer = (customDataTypes: PLCDataType[]) => {
  const isStructure = (dt: PLCDataType): dt is PLCStructureDatatype =>
    dt?.derivation === 'structure' && Array.isArray(dt.variable) && dt.variable.length > 0

  const allVariableNames = customDataTypes
    .filter(isStructure)
    .flatMap((dt) => dt.variable.map((v) => v.name))
    .filter((name, index, arr) => arr.indexOf(name) === index) // Remove duplicates

  // Update the global array and language definition
  customDataTypeVariables.length = 0
  customDataTypeVariables.push(...allVariableNames)
  language.customDataTypeVariables = customDataTypeVariables

  // Re-register the language with Monaco
  void import('monaco-editor').then((monaco) => {
    monaco.languages.setMonarchTokensProvider('st', language)
  })
}

export const updateEnumValuesInTokenizer = (customDataTypes: PLCDataType[]) => {
  const allEnumValues = customDataTypes
    .filter((dt) => dt?.derivation === 'enumerated' && dt.values.length > 0)
    .flatMap((dt) => (dt as PLCEnumeratedDatatype).values.map((v) => v.description))
    .filter((value, index, arr) => arr.indexOf(value) === index)

  if (allEnumValues.length === 0) return

  customEnumValueKeywords.length = 0
  customEnumValueKeywords.push(...allEnumValues)
  language.tokenizer.root.unshift([new RegExp(`\\b(${customEnumValueKeywords.join('|')})\\b`, 'i'), 'keyword'])

  void import('monaco-editor').then((monaco) => {
    monaco.languages.setMonarchTokensProvider('st', language)
  })
}
