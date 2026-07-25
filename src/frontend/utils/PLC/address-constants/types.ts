export const PLC_ADDRESS_PREFIX = {
  BOOL_OUTPUT: '%QX',
  BOOL_INPUT: '%IX',
  BOOL_MEMORY: '%MX',
  BYTE_OUTPUT: '%QB',
  BYTE_INPUT: '%IB',
  BYTE_MEMORY: '%MB',
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

// Each IEC size class accepts all three area prefixes — input (I), output (Q)
// and memory (M) — matching what strucpp and the runtime image tables support:
//   X = bit (BOOL), B = byte (BYTE/SINT/USINT), W = word (INT/UINT/WORD),
//   D = dword (DINT/UDINT/REAL/DWORD), L = lword (LINT/ULINT/LREAL/LWORD).
// NOTE: %MB (memory byte) is accepted here even though the runtime does not
// yet back it (no byte_memory buffer) — a runtime fix is planned separately.
export const BOOL_LOCATION_REGEX = /^%[QIM]X\d+\.\d$/
export const BYTE_LOCATION_REGEX = /^%[QIM]B\d+$/
export const WORD_LOCATION_REGEX = /^%[QIM]W\d+$/
export const DWORD_LOCATION_REGEX = /^%[QIM]D\d+$/
export const LWORD_LOCATION_REGEX = /^%[QIM]L\d+$/
