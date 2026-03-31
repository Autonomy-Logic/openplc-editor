/**
 * PLC domain constants — IEC 61131-3 base types and language definitions.
 *
 * These are pure value arrays with no external dependencies.
 * Used across components, store slices, and validators.
 */

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

type PLCBaseType = (typeof baseTypes)[number]

const PLCLanguagesShortenedForm = ['IL', 'ST', 'LD', 'FBD', 'SFC'] as const

const PLCFunctionBlockLanguages = ['IL', 'ST', 'LD', 'FBD', 'SFC', 'python', 'cpp'] as const

const PLCFunctionLanguages = ['IL', 'ST', 'LD', 'FBD', 'SFC'] as const

const PLCProgramLanguages = ['IL', 'ST', 'LD', 'FBD', 'SFC'] as const

const PLCLanguages = [
  'instruction-list',
  'structured-text',
  'ladder-diagram',
  'function-block-diagram',
  'sequential-function-chart',
] as const

export {
  baseTypes,
  PLCFunctionBlockLanguages,
  PLCFunctionLanguages,
  PLCLanguages,
  PLCLanguagesShortenedForm,
  PLCProgramLanguages,
}
export type { PLCBaseType }
