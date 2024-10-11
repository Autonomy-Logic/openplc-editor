const baseTypes = [
  'BOOL',
  'SINT',
  'INT',
  'DINT',
  'LINT',
  'USINT',
  'UINT',
  'UDINT',
  'ULINT',
  'REAL',
  'LREAL',
  'TIME',
  'DATE',
  'TOD',
  'DT',
  'STRING',
  'BYTE',
  'WORD',
  'DWORD',
  'LWORD',
  'LOGLEVEL',
] as const

const PLCLanguagesShortenedForm = ['IL', 'ST', 'LD', 'FBD', 'SFC'] as const

const PLCLanguages = [
  'instruction-list',
  'structured-text',
  'ladder-diagram',
  'function-block-diagram',
  'sequential-function-chart',
] as const

export { baseTypes, PLCLanguages, PLCLanguagesShortenedForm }
