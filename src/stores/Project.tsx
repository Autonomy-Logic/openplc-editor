import { produce } from 'immer'
import { createStore } from 'zustand'

import { IPouProps, IProjectProps, IProjectState } from '@/types/project-store'

const projectStore = createStore<IProjectState>()((set) => ({
  filePath: null,
  projectXmlAsObj: null,
  setWorkspaceProject: (project: IProjectProps) =>
    set(
      produce((s) => {
        s.projectXmlAsObj = project.projectXmlAsObj
        s.filePath = project.filePath
      }),
    ),
  addPouInProject: (pou: IPouProps) => {
    set(
      produce((s) => {
        s.projectXmlAsObj.project.types.pous[pou.name] = pou
      }),
    )
  },
  updateDateTime: (updateDate: string) =>
    set(
      produce((s) => {
        console.log('State in projectStore -> ', s.currentProject)
        // console.warn('UpdateDateProp ->', updateDate)
        // s.currentProject.projectXmlAsObj.contentHeader[
        //   '@modificationDateTime'
        // ] = updateDate
      }),
    ),
}))

export default projectStore
