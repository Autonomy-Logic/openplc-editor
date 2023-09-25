import { CONSTANTS } from '@shared/constants'
import { produce } from 'immer'
import { create } from 'zustand'

interface IPouProps {
  id?: number
  name: string
  type: (typeof CONSTANTS.types)[keyof typeof CONSTANTS.types]
  language?: (typeof CONSTANTS.languages)[keyof typeof CONSTANTS.languages]
  body?: string | undefined
}

interface IPousState {
  pous: Record<string, IPouProps>
}

interface IPousStore extends IPousState {
  createNewPou: (pouData: IPouProps) => void
  writeInPou: (data: { pouName: string; body: string }) => void
}

const pouStore = create<IPousStore>()((set) => ({
  pous: {
    program0: {
      id: 1,
      name: 'program0',
      type: 'program',
      language: 'LD',
      body: 'A simple string for program body',
    },
    function0: {
      id: 1,
      name: 'function0',
      type: 'function',
      language: 'IL',
      body: 'A simple string for function body',
    },
  },
  createNewPou: (pouData: IPouProps) => {
    set(
      produce((s) => {
        s.pous[pouData.name] = pouData
      }),
    )
  },
  writeInPou: (data: { pouName: string; body: string }) =>
    set(
      produce((s) => {
        s.pous[data.pouName].body = data.body
      }),
    ),
}))

export default pouStore
