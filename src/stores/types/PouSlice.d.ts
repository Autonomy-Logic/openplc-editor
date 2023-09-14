import { CONSTANTS } from '@shared/constants'

interface PouSlice {
  pouData: {
    name?: string
    type: (typeof CONSTANTS.types)[keyof typeof CONSTANTS.types]
    language?: (typeof CONSTANTS.languages)[keyof typeof CONSTANTS.languages]
    body?: string
  }
  setPouData: (data: {
    name?: string
    type: (typeof CONSTANTS.types)[keyof typeof CONSTANTS.types]
    language?: (typeof CONSTANTS.languages)[keyof typeof CONSTANTS.languages]
    body?: string
  }) => void
  updateBody: (body: string | undefined) => void
}

export { PouSlice }
