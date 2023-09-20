import { CONSTANTS } from '@shared/constants'
import { produce } from 'immer'
import { create } from 'zustand'

import { xmlProject } from '@/@types/xmlProject'

interface IPouProps {
  id?: number
  name: string
  type: (typeof CONSTANTS.types)[keyof typeof CONSTANTS.types]
  language?: (typeof CONSTANTS.languages)[keyof typeof CONSTANTS.languages]
  body?: string | undefined
}
interface IProjectProps {
  filePath?: string
  projectXmlAsObj?: xmlProject
}

interface IProjectState extends IProjectProps {
  setWorkspaceProject: (project: IProjectProps) => void
  addPouInProject: (pou: IPouProps) => void
  updateDateTime: (updateDate: string) => void
}

const projectStore = create<IProjectState>()((set) => ({
  currentProject: {},
  setWorkspaceProject: (project: IProjectProps) =>
    set(
      produce((s) => {
        s.currentProject = project
      }),
    ),
  addPouInProject: async (pou: IPouProps) =>
    set(
      produce((s) => {
        s.currentProject.projectXmlAsObj.types['pous'] = pou
      }),
    ),
  updateDateTime: (updateDate: string) =>
    set(
      produce((s) => {
        s.currentProject.projectXmlAsObj.contentHeader[
          '@modificationDateTime'
        ] = updateDate
      }),
    ),
}))

export default projectStore
