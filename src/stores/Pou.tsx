import { CONSTANTS } from '@shared/constants'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

interface IPouProps {
  programOrganizationUnity: {
    id: number
    name: string
    type: (typeof CONSTANTS.types)[keyof typeof CONSTANTS.types]
    language?: (typeof CONSTANTS.languages)[keyof typeof CONSTANTS.languages]
    body: string | undefined
  }
}

interface IPouState extends IPouProps {
  setPouData: (pouData: any) => void
  writeInPou: (body: string | undefined) => void
}

const pouStore = create<IPouState>()(
  immer((set) => ({
    programOrganizationUnity: {
      id: 0,
      name: 'program0',
      type: 'program',
      language: 'ST',
      body: '',
    },
    setPouData: (pouData: any) =>
      set((s) => {
        s.programOrganizationUnity = pouData
      }),
    writeInPou: (body: string | undefined) =>
      set((s) => {
        s.programOrganizationUnity.body = body
      }),
  })),
)

export default pouStore
