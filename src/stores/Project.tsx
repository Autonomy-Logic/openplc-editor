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

const projectStore = create<IProjectState>()((set, get) => ({
  currentProject: {
    filePath: '',
    projectXmlAsObj: {
      '@xmlns:ns1': 'http://www.plcopen.org/xml/tc6.xsd',
      '@xmlns:xhtml': 'http://www.w3.org/1999/xhtml',
      '@xmlns:xsd': 'http://www.w3.org/2001/XMLSchema',
      '@xmlns': 'http://www.plcopen.org/xml/tc6_0201',
      fileHeader: {
        '@companyName': 'Unknown',
        '@productName': 'Unnamed',
        '@productVersion': '1',
        '@creationDateTime': new Date().toISOString,
      },
      contentHeader: {
        '@name': 'Unnamed',
        '@modificationDateTime': new Date().toISOString,
        coordinateInfo: {
          fbd: {
            scaling: {
              '@x': '10',
              '@y': '10',
            },
          },
          ld: {
            scaling: {
              '@x': '10',
              '@y': '10',
            },
          },
          sfc: {
            scaling: {
              '@x': '10',
              '@y': '10',
            },
          },
        },
      },
      types: {
        dataTypes: {},
        pous: {},
      },
      instances: {
        configurations: {
          configuration: {
            '@name': 'Config0',
            resource: {
              '@name': 'Res0',
            },
          },
        },
      },
    },
  },
  setWorkspaceProject: (project: IProjectProps) =>
    set(
      produce((s) => {
        s.currentProject = project
      }),
    ),
  addPouInProject: (pou: IPouProps) => {
    console.log('Here -> ', get().projectXmlAsObj)
    set(
      produce((s) => {
        s.currentProject.projectXmlAsObj['types'] = pou
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
