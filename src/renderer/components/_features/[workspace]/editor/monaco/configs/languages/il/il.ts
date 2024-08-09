import { languages } from 'monaco-editor'

export const conf: languages.LanguageConfiguration = {
  /**
   * This defines the block that will be auto closed
   */
  autoClosingPairs: [
    { open: '(', close: ')' },
    { open: '[', close: ']' },
    { open: '{', close: '}' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
  /**
   * This defines the block that will be colorized
   */
  colorizedBracketPairs: [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
  ],
  /**
   * This defines the comment setting
   */
  comments: {
    lineComment: '//',
    blockComment: ['(*', '*)'],
  },
  /**
   * This defines the folding setting
   */
  folding: {
    markers: {
      start: /^\s*#region\b/,
      end: /^\s*#endregion\b/,
    },
  },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
  ],
}

export const language: languages.IMonarchLanguage = {
  tokenizer: {
    root: [
      [/LABEL:/, 'label'],
      [
        /[a-zA-Z_]\w*/,
        {
          cases: {
            '@keywords': 'keyword',
            '@typeKeywords': 'type',
            '@operators': 'operator',
            '@default': 'identifier',
          },
        },
      ],
      { include: '@whitespace' },
      // Delimiters and operators
      [/[{}()[\]]/, '@brackets'], // Tokenize brackets
      [/[<>](?![=><!~?:&|+\-*/^%])/, '@brackets'],
      [/[=><!~?:&|+\-*/^%]/, 'operator'],
      // Numbers
      [/\d+\.\d*\([eE][-+]?\d+\)?/, 'number.float'], //Tokenize float number
      [/\d+/, 'number'],
      // Comments
      [/\/\/.*/, 'comment'],
      [/\(\*[\s\S]*?\*\)/, 'comment'],
      // Strings
      [/"([^"\\]|\\.)*$/, 'string.invalid'], // non-terminated string
      [/"/, 'string', '@string'],
    ],
    string: [
      [/[^"\\]+/, 'string'],
      [/\\./, 'string.escape'],
      [/"/, 'string', '@pop'],
    ],
    whitespace: [
      [/[ \t\r\n]+/, 'white'], // Tokenize whitespace (spaces, tabs, line breaks)
    ],
  },
  keywords: [
    'PROGRAM',
    'END_PROGRAM',
    'FUNCTION',
    'END_FUNCTION',
    'FUNCTION_BLOCK',
    'END_FUNCTION_BLOCK',
    'VAR',
    'END_VAR',
    'VAR_INPUT',
    'VAR_OUTPUT',
    'VAR_IN_OUT',
    'VAR_TEMP',
    'VAR_GLOBAL',
    'VAR_EXTERNAL',
    'IF',
    'THEN',
    'ELSE',
    'END_IF',
    'FOR',
    'TO',
    'DO',
    'END_FOR',
    'WHILE',
    'END_WHILE',
    'REPEAT',
    'UNTIL',
    'END_REPEAT',
    'RETURN',
  ],
  typeKeywords: [
    'BOOL',
    'SINT',
    'INT',
    'DINT',
    'LINT',
    'USINT',
    'UDINT',
    'ULINT',
    'REAL',
    'LREAL',
    'TIME',
    'DATE',
    'TIME_OF_DAY',
    'TOD',
    'DATE_AND_TIME',
    'DT',
    'STRING',
    'BYTE',
    'WORD',
    'DWORD',
    'LWORD',
    'WSTRING',
  ],
  operators: [
    'LD',
    'ST',
    'S',
    'R',
    'AND',
    '&',
    'OR',
    'XOR',
    'NOT',
    'ADD',
    'SUB',
    'MUL',
    'DIV',
    'MOD',
    'GT',
    'GE',
    'EQ',
    'NE',
    'LE',
    'LT',
    'JMP',
    'CAL',
    'RET',
  ],
}
