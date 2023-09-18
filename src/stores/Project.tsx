import { XMLSerializedAsObject } from 'xmlbuilder2/lib/interfaces'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

interface IProjectProps {
  currentProject: {
    filePath?: string
    xmlSerializedAsObject?: XMLSerializedAsObject
  }
}

interface IProjectState extends IProjectProps {
  setCurrentProject: (project: any) => void
}

const projectStore = create<IProjectState>()(
  immer((set) => ({
    currentProject: {},
    setCurrentProject: (project: any) =>
      set((s) => {
        console.log('Current', s.currentProject),
          console.log('Incoming', project)
      }),
  })),
)

export default projectStore
