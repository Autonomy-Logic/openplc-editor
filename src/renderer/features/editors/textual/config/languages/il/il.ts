import { languages } from 'monaco-editor'

export const conf: languages.LanguageConfiguration = {}

export const language: languages.IMonarchLanguage = {
  tokenizer: {
    root: [
      [
        /[a-zA-Z_]\w*/,
        {
          cases: {
            '@keywords': 'keyword',
            '@operators': 'operators',
            '@typeKeywords': 'type',
          },
        },
      ],
      [
        /\/\/.*/,
        'comment', // Tokenize comment of line
      ],
      [
        /\(\*[\s\S]*?\*\)/,
        'block-comment', // Tokenize block of comment
      ],
    ],
  },
  keywords: ['VAR', 'END_VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT', 'VAR_TEMP', 'VAR_GLOBAL', 'VAR_EXTERNAL'],
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
    ')',
  ],
}
