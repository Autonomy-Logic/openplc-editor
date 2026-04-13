export const PLC_ADDRESS_PREFIX = {
  BOOL_OUTPUT: '%QX',
  BOOL_INPUT: '%IX',
  WORD_OUTPUT: '%QW',
  WORD_INPUT: '%IW',
  WORD_MEMORY: '%MW',
  DWORD_MEMORY: '%MD',
  LWORD_MEMORY: '%ML',
} as const

export const BOOL_LOCATION_REGEX = /^%[QI]X\d+\.\d$/
export const WORD_LOCATION_REGEX = /^%[QIM]W\d+$/
export const DWORD_LOCATION_REGEX = /^%MD\d+$/
export const LWORD_LOCATION_REGEX = /^%ML\d+$/
