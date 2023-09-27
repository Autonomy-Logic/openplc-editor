import { CONSTANTS } from '@shared/constants'
import { produce } from 'immer'
import { create } from 'zustand'

import { xmlProject } from '@/@types/xmlProject'

interface IPouProps {
  name: string
  type: (typeof CONSTANTS.types)[keyof typeof CONSTANTS.types]
  language?: (typeof CONSTANTS.languages)[keyof typeof CONSTANTS.languages]
  body?: string | undefined
}
interface IProjectProps {
  filePath: string | null
  projectXmlAsObj: xmlProject | null
}

interface IProjectState extends IProjectProps {
  setWorkspaceProject: (project: IProjectProps) => void
  addPouInProject: (pou: IPouProps) => void
  updateDateTime: (updateDate: string) => void
}

const projectStore = create<IProjectState>()((set, get) => ({
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
        console.log(get().projectXmlAsObj)
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
