import { CONSTANTS } from '@shared/constants'

const { types, languages } = CONSTANTS

export interface PouSlice {
  pouData: {
    name?: string
    type: (typeof types)[keyof typeof types]
    language?: (typeof languages)[keyof typeof languages]
    body?: string
  }
  setPouData: (data: {
    name?: string
    type: (typeof types)[keyof typeof types]
    language?: (typeof languages)[keyof typeof languages]
    body?: string
  }) => void
  updateBody: (body: string | undefined) => void
}
