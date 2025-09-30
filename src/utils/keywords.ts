const booleanTypes = ['BOOL']
const unsignedIntegerTypes = ['ANY_NUM', 'USINT', 'UINT', 'UDINT', 'ULINT', 'BYTE', 'WORD', 'DWORD', 'LWORD']
const integerTypes = ['SINT', 'INT', 'DINT', 'LINT', ...unsignedIntegerTypes]
const floatTypes = ['ANY_NUM', 'REAL', 'LREAL']

export const literals = [
  // Boolean Literals
  { pattern: /^TRUE|FALSE|0|1$/, types: booleanTypes },
  // Number literals
  { pattern: /^2#[01_]+$/, types: integerTypes },
  { pattern: /^8#[0-7_]+$/, types: integerTypes },
  { pattern: /^16#[0-9A-Fa-f_]+$/, types: integerTypes },
  { pattern: /^-?[0-9]+\.?[0-9]*$/, types: floatTypes },
  { pattern: /^-?[0-9]+$/, types: integerTypes },
  // Time literals
  { pattern: /^T#[0-9:\-_shmydSMHDY]+$/, types: ['TIME'] },
  { pattern: /^D#[0-9:\-_shmydSMHDY]+$/, types: ['DATE'] },
  { pattern: /^TOD#[0-9:\-_shmydSMHDY]+$/, types: ['TOD'] },
  { pattern: /^DT#[0-9:\-_shmydSMHDY]+$/, types: ['DT'] },
  // String literals
  { pattern: /^'.*'$/, types: ['STRING'] },
]

export function getLiteralType(name: string) {
  const result = literals.find((x) => x.pattern.test(name))
  if (result) {
    return ['ANY', ...result.types]
  }
}

export function isLiteral(name: string) {
  return getLiteralType(name) !== undefined
}

export const keywords = [
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
]

export const builtinFunctions = [
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
]

export const protectedWords = [...keywords, ...builtinFunctions]
