import { languages } from 'monaco-editor'

const symbols = /[=><~?:+\-*^%&|.;]+/
const escapes = /\$[$'"NLRT]|\$[0-9]{2,4}/
const timeLiterals = /[TDTODD]#[0-9:\-_shmydSMHDY]+/
const bitLiterals = /[XBWDL]#[0-9A-Fa-f_]+|%[IQM][XBWDL]?[0-9.]+/
const gxwDevices = /\b[MTCRSDXYZ][0-9]{1,5}(?:[ZV][0-9])?\b/

export const conf: languages.LanguageConfiguration = {
  comments: {
    lineComment: '//',
    blockComment: ['(*', '*)'],
  },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
    ['(*', '*)'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '(*', close: '*)' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
    { open: '/*', close: '*/' },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
}

export const language: languages.IMonarchLanguage = {
  ignoreCase: true,
  defaultToken: 'invalid',
  tokenPostfix: '.st',

  keywords: [
    // Controle de fluxo
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
    'BEGIN',

    // Declarações
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
    'END_VAR',
    'STRUCT',
    'END_STRUCT',
    'UNION',
    'END_UNION',
    'PROPERTY',
    'END_PROPERTY',
    'PROGRAM',
    'FUNCTION_BLOCK',
    'FUNCTION',
    'TYPE',
    'END_TYPE',
    'END_FUNCTION_BLOCK',
    'END_FUNCTION',
    'END_PROGRAM',
    'CLASS',
    'CONFIGURATION',
    'RESOURCE',
    'ACTION',
    'STEP',
    'INITIAL_STEP',
    'TRANSITION',
    'NAMESPACE',
    'METHOD',
    'CONST',
    'DATA_BLOCK',
    'LABEL',

    // Tipos primitivos
    'AT',
    'BOOL',
    'BYTE',
    'WORD',
    'DWORD',
    'LWORD',
    'SINT',
    'USINT',
    'INT',
    'UINT',
    'DINT',
    'UDINT',
    'LINT',
    'ULINT',
    'REAL',
    'LREAL',
    'TIME',
    'DATE',
    'TIME_OF_DAY',
    'TOD',
    'DT',
    'DATE_AND_TIME',
    'STRING',
    'WSTRING',
    'ARRAY',
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

    // Constantes
    'TRUE',
    'FALSE',
    'NULL',
    'NIL',
    'VOID',

    // Operadores lógicos
    'AND',
    'OR',
    'NOT',
    'XOR',
    'NOR',
    'OR_ELSE',
    'AND_THEN',

    // OOP
    'EXTENDS',
    'IMPLEMENTS',
    'THIS',
    'SUPER',
    'GET',
    'SET',
    'ABSTRACT',
    'FINAL',
    'PUBLIC',
    'PRIVATE',
    'PROTECTED',
    'INTERNAL',

    // Temporizadores/Contadores
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

    // Modificadores
    'CONSTANT',
    'RETAIN',
    'PERSISTENT',
    'REF',
    'POINTER',
    'REF_TO',

    // Outros
    'WITH',
    'USING',
    'FROM',
    'OF',
    'OVERLAP',
  ],

  operators: [
    ':=',
    '=',
    '<>',
    '<=',
    '>=',
    '<',
    '>',
    '=>',
    '..',
    '+',
    '-',
    '*',
    '/',
    '**',
    'MOD',
    '^',
    '&',
    '|',
    'S=',
    'R=',
    'GE',
    'LE',
    'EQ',
    'NE',
    'GT',
    'LT',
  ],

  builtinFunctions: [
    'ABS',
    'ACOS',
    'ASIN',
    'ATAN',
    'COS',
    'SIN',
    'TAN',
    'EXP',
    'EXPT',
    'LN',
    'LOG',
    'SQRT',
    'TRUNC',
    'ROUND',
    'FLOOR',
    'CEIL',
    'MOVE',
    'CONCAT',
    'DELETE',
    'FIND',
    'INSERT',
    'LEFT',
    'LEN',
    'REPLACE',
    'RIGHT',
    'MID',
    'SEL',
    'MUX',
    'SHL',
    'SHR',
    'ROL',
    'ROR',
    'ADD',
    'DIV',
    'MUL',
    'SUB',
    'MAX',
    'MIN',
    'LIMIT',
    'ADR',
    'SIZE',
    'BIT_ADR',
    'REF',
    'UNPACK',
    'SEMA',
    'RTC',
    '__NEW',
    '__DELETE',
  ],

  symbols,
  escapes,
  timeLiterals,
  bitLiterals,
  gxwDevices,
  variables: /[a-zA-Z_][\w]*/,

  tokenizer: {
    root: [
      // Comentários com tags especiais
      [/\/\/\s*(TODO|FIX):?/, 'comment.todo'],
      [/\(\*\s*(TODO|FIX):?/, { token: 'comment.todo', next: '@commentBlock' }],
      [/\/\*\s*(TODO|FIX):?/, { token: 'comment.todo', next: '@commentBlockC' }],

      // Comentários
      [/\/\/.*$/, 'comment'],
      [/\(\*/, { token: 'comment', next: '@commentBlock' }],
      [/\/\*/, { token: 'comment', next: '@commentBlockC' }],

      // Atributos em comentários
      [/\{/, { token: 'attribute', next: '@attributeBlock' }],

      // Strings
      [/(W?STRING)#"/, { token: 'type', next: '@stringPrefixed' }],
      [/(W?STRING)#'/, { token: 'type', next: '@stringPrefixedSingle' }],
      [/"/, { token: 'string.quote', next: '@stringDouble' }],
      [/'/, { token: 'string.quote', next: '@stringSingle' }],

      // Números - Todas as bases
      [/\b(2#[01_]+)\b/, 'number.binary'],
      [/\b(8#[0-7_]+)\b/, 'number.octal'],
      [/\b(16#[0-9A-Fa-f_]+)\b/, 'number.hex'],
      [/\b(H[0-9A-Fa-f]+)\b/, 'number.hex'],
      [/\b(K[0-9]+)\b/, 'number'],
      [
        /\b(BYTE|WORD|DWORD|LWORD|SINT|USINT|INT|UINT|DINT|UDINT|LINT|ULINT)#(2#[01_]+|8#[0-7_]+|16#[0-9A-Fa-f_]+)\b/,
        ['type', 'number'],
      ],
      [/\b(BYTE|WORD|DWORD|LWORD|SINT|USINT|INT|UINT|DINT|UDINT|LINT|ULINT)#-?[0-9_]+\b/, ['type', 'number']],
      [/\b(REAL|LREAL)#-?[0-9_]+\.[0-9_]+([eE][-+]?[0-9]+)?\b/, ['type', 'number.float']],
      [/\b[0-9]+\.[0-9]+([eE][-+]?[0-9]+)?\b/, 'number.float'],
      [/\b[0-9]+\b/, 'number'],

      // Constantes de tempo
      [timeLiterals, 'number.time'],

      // Variáveis especiais (IEC 61131-3)
      [bitLiterals, 'variable.predefined'],
      [gxwDevices, 'variable.predefined'],
      [/\b[ZV][0-9]\b/, 'variable.predefined'],

      // Tipos com prefixo
      [/\b(?:POINTER TO|REF_TO|REF|AT)\b/, 'keyword'],

      // Funções built-in
      [
        /(\b(?:ABS|SIN|COS|TAN|EXP|LN|LOG|SQRT|ROUND|TRUNC|MUX|SEL|SHL|SHR|ROL|ROR|CTU|CTD|TON|TOF|RS|SR|R_TRIG|F_TRIG)\b)(\()/,
        ['function.builtin', { token: 'delimiter.parenthesis', next: '@functionCall' }],
      ],

      // Chamadas de função
      [/([a-zA-Z_]\w*)(\()/, ['identifier', { token: 'delimiter.parenthesis', next: '@functionCall' }]],

      // Palavras-chave
      [/VAR_[A-Z_]+|END_[A-Z_]+|__[A-Z_]+/, 'keyword'], // Palavras compostas
      [
        /[a-zA-Z_]\w*/,
        {
          cases: {
            '@keywords': 'keyword',
            '@builtinFunctions': 'function.builtin',
            '@operators': 'operator',
            '@default': 'identifier',
          },
        },
      ],

      // Operadores
      [
        /:?=/,
        {
          cases: {
            ':=': 'operator.assignment',
            '=>': 'operator.arrow',
            '@default': 'operator',
          },
        },
      ],
      [
        symbols,
        {
          cases: {
            '@operators': 'operator',
            '@default': '',
          },
        },
      ],

      // Delimitadores
      [/[;,]/, 'delimiter'],
      [/\.\./, 'operator.range'],
      [/(\.)([a-zA-Z_]\w*)/, ['delimiter', 'property']], // Acesso a membros

      // Whitespace
      { include: '@whitespace' },

      // Brackets
      [/[{}()[\]]/, '@brackets'],
    ],

    functionCall: [
      [/(\))/, { token: 'delimiter.parenthesis', next: '@pop' }],
      [/(,)/, 'delimiter'],
      [/([a-zA-Z_]\w*)(\s*:)?/, ['identifier', { token: 'delimiter', next: '@parameter' }]],
      { include: '@root' },
    ],

    parameter: [
      [/=>/, 'operator.arrow'],
      [/[a-zA-Z_]\w*/, 'variable.parameter'],
      [/\)/, { token: 'delimiter.parenthesis', next: '@pop' }],
      { include: '@root' },
    ],

    attributeBlock: [
      [/\}/, { token: 'attribute', next: '@pop' }],
      [/(attribute|text|info|warning)\b/, 'keyword.attribute'],
      [/'[^']*'/, 'string.attribute'],
      [/:=/, 'operator.assignment'],
      { include: '@root' },
    ],

    commentBlock: [
      [/\(\*/, 'comment', '@push'],
      [/\*\)/, 'comment', '@pop'],
      [/(@[a-zA-Z_]*)\s*(:=)\s+('[^']*')/, ['variable.parameter', 'operator.assignment', 'string']],
      [/./, 'comment'],
    ],

    commentBlockC: [
      [/\/\*/, 'comment', '@push'],
      [/\*\//, 'comment', '@pop'],
      [/./, 'comment'],
    ],

    stringDouble: [
      [/[^\\"$]+/, 'string'],
      [escapes, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/"/, 'string', '@pop'],
    ],

    stringSingle: [
      [/[^\\'$]+/, 'string'],
      [escapes, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/'/, 'string', '@pop'],
    ],

    stringPrefixed: [
      [/[^\\"$]+/, 'string'],
      [escapes, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/"/, { token: 'string', next: '@pop' }],
    ],

    stringPrefixedSingle: [
      [/[^\\'$]+/, 'string'],
      [escapes, 'string.escape'],
      [/\\./, 'string.escape.invalid'],
      [/'/, { token: 'string', next: '@pop' }],
    ],

    whitespace: [
      [/[ \t\r\n]+/, 'white'],
      [/^\s*/, 'white'],
    ],
  },
}
