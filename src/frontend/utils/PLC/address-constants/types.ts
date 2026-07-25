export const PLC_ADDRESS_PREFIX = {
  BOOL_OUTPUT: '%QX',
  BOOL_INPUT: '%IX',
  BOOL_MEMORY: '%MX',
  WORD_OUTPUT: '%QW',
  WORD_INPUT: '%IW',
  WORD_MEMORY: '%MW',
  DWORD_OUTPUT: '%QD',
  DWORD_INPUT: '%ID',
  DWORD_MEMORY: '%MD',
  LWORD_OUTPUT: '%QL',
  LWORD_INPUT: '%IL',
  LWORD_MEMORY: '%ML',
} as const

// Accept every valid IEC area prefix — input (I), output (Q) and memory (M).
// `%MX` memory bits are legitimate (e.g. Modbus coils) and were previously
// rejected here, unlike the word-width regexes below which already allow M.
export const BOOL_LOCATION_REGEX = /^%[QIM]X\d+\.\d$/
export const WORD_LOCATION_REGEX = /^%[QIM]W\d+$/
export const DWORD_LOCATION_REGEX = /^%[QIM]D\d+$/
export const LWORD_LOCATION_REGEX = /^%[QIM]L\d+$/
