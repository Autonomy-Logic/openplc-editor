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
            '@typeKeywords': 'type',
            '@operators': 'operator',
            '@default': 'identifier',
          },
        },
      ],
      [/\/\/.*/, 'comment'], // Tokenize single line comment
      [/\(\*[\s\S]*?\*\)/, 'comment'], // Tokenize block comment
      [/\d+/, 'number'], // Tokenize numbers
      [/[;,.]/, 'delimiter'], // Tokenize delimiters
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
  ],
}
