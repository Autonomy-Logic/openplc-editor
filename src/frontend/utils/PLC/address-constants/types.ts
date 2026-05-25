export const PLC_ADDRESS_PREFIX = {
  BOOL_OUTPUT: '%QX',
  BOOL_INPUT: '%IX',
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

export const BOOL_LOCATION_REGEX = /^%[QI]X\d+\.\d$/
export const WORD_LOCATION_REGEX = /^%[QIM]W\d+$/
export const DWORD_LOCATION_REGEX = /^%[QIM]D\d+$/
export const LWORD_LOCATION_REGEX = /^%[QIM]L\d+$/
