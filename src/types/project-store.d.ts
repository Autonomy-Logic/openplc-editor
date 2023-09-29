import { CONSTANTS } from '@shared/constants'

import { xmlProject } from '@/types/xmlProject'

export interface IPouProps {
  name: string
  type: (typeof CONSTANTS.types)[keyof typeof CONSTANTS.types]
  language?: (typeof CONSTANTS.languages)[keyof typeof CONSTANTS.languages]
  body?: string | undefined
}
export interface IProjectProps {
  filePath: string | null
  projectXmlAsObj: xmlProject | null
}

export interface IProjectState extends IProjectProps {
  setWorkspaceProject: (project: IProjectProps) => void
  addPouInProject: (pou: IPouProps) => void
  updateDateTime: (updateDate: string) => void
}
