import { merge } from 'lodash'
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
  addPou: (pou: any) => void
}

const projectStore = create<IProjectState>()(
  immer((set) => ({
    currentProject: {},
    setCurrentProject: (project: any) =>
      set((s) => {
        s.currentProject = project
      }),
    addPou: (pou: any) =>
      set((s) => {
        s.currentProject.xmlSerializedAsObject = merge(pou)
      }),
  })),
)

export default projectStore
