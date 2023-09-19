import { CONSTANTS } from '@shared/constants'
import { formatDate } from '@shared/utils'
import { isObject, merge } from 'lodash'
import { createContext, FC, PropsWithChildren, useCallback } from 'react'
import { XMLSerializedAsObject } from 'xmlbuilder2/lib/interfaces'
import { useStore } from 'zustand'

import { useIpcRender, useToast } from '@/hooks'
import pouStore from '@/stores/Pou'
import projectStore from '@/stores/Project'
/**
 * Extract properties from the imported CONSTANTS object.
 */
const {
  types,
  languages,
  channels: { get, set },
} = CONSTANTS
/**
 * Represents the properties of a project.
 */
type ProjectProps = {
  language?: (typeof languages)[keyof typeof languages]
  xmlSerializedAsObject?: XMLSerializedAsObject
  filePath?: string
}
/**
 * Represents the data needed to create a new POU.
 */
type CreatePouData = {
  name?: string
  type: (typeof types)[keyof typeof types]
  language?: (typeof languages)[keyof typeof languages]
}
/**
 * Represents the data needed to send a project for saving.
 */
type SendProjectToSaveData = {
  project?: XMLSerializedAsObject
  filePath?: string
}
/**
 * Represents the data needed to update the documentation of a POU.
 */
type UpdateDocumentationData = {
  pouName: string
  description: string
}
/**
 * Represents the response when fetching project properties.
 */
type GetProjectProps = {
  ok: boolean
  reason?: { title: string; description?: string }
  data?: ProjectProps
}
/**
 * The context for managing project-related data.
 */
export type ProjectContextData = {
  currentProject?: ProjectProps
  getXmlSerializedValueByPath: (
    propertyPath: string,
  ) => XMLSerializedAsObject | string | undefined
  getProject: (path: string) => Promise<void>
  createPOU: (data: CreatePouData) => void
  updateDocumentation: (data: UpdateDocumentationData) => void
}

export const ProjectContext = createContext<ProjectContextData>(
  {} as ProjectContextData,
)

// TODO: Remove mock project
/**
 * Mock project data used for initialization.
 */
export const mockProject: ProjectProps = {
  filePath: 'C:\\Users\\SILU\\Downloads\\electron',
  language: 'LD',
  xmlSerializedAsObject: {
    project: {
      '@xmlns:ns1': 'http://www.plcopen.org/xml/tc6.xsd',
      '@xmlns:xhtml': 'http://www.w3.org/1999/xhtml',
      '@xmlns:xsd': 'http://www.w3.org/2001/XMLSchema',
      '@xmlns': 'http://www.plcopen.org/xml/tc6_0201',
      fileHeader: {
        '@companyName': 'Unknown',
        '@productName': 'Unnamed',
        '@productVersion': '1',
        '@creationDateTime': '2023-07-03T20:25:15',
      },
      contentHeader: {
        '@name': 'Unnamed',
        '@modificationDateTime': '2023-07-03T20:25:15',
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
        pous: {
          pou: {
            '@name': 'program0',
            '@pouType': 'program',
            body: {
              LD: {
                leftPowerRail: {
                  '@localId': '1',
                  '@heigh': '40',
                  '@width': '10',
                  position: {
                    '@x': '200',
                    '@y': '200',
                  },
                  connectionPointOut: {
                    '@formalParameter': '',
                    relPosition: {
                      '@x': '10',
                      '@y': '20',
                    },
                  },
                },
                rightPowerRail: {
                  '@localId': '2',
                  '@heigh': '40',
                  '@width': '10',
                  position: {
                    '@x': '800',
                    '@y': '200',
                  },
                  connectionPointIn: {
                    relPosition: {
                      '@x': '0',
                      '@y': '20',
                    },
                    connection: {
                      '@refLocalId': '1',
                      position: [
                        {
                          '@x': '800',
                          '@y': '220',
                        },
                        {
                          '@x': '210',
                          '@y': '220',
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
      instances: {
        configurations: {
          configuration: {
            '@name': 'Config0',
            resource: {
              '@name': 'Res0',
              task: {
                '@name': 'task0',
                '@priority': '0',
                '@interval': 'T#20ms',
                pouInstance: {
                  '@name': 'instance0',
                  '@typeName': 'program0',
                },
              },
            },
          },
        },
      },
    },
  },
}
/**
 * Provides the project context to the application.
 * @param children The children components wrapped by the context provider.
 * @returns A JSX Component with the project context provider
 */
const ProjectProvider: FC<PropsWithChildren> = ({ children }) => {
  const { currentProject, addPou, setCurrentProject } = useStore(projectStore)
  const { programOrganizationUnity, setPouData } = useStore(pouStore)
  /**
   * Define state to hold project data and a function to update it.
   */
  // const [project, setProject] = useState<ProjectProps>(mockProject)
  /**
   * Destructure the createToast function from the useToast hook.
   */
  const { createToast } = useToast()
  /**
   * Use the useIpcRender hook to invoke a renderer process event.
   */
  const { invoke } = useIpcRender<string, GetProjectProps>({
    channel: get.PROJECT,
    /**
     * Callback function for handling the response from the renderer process.
     */
    callback: ({ ok, data, reason }) => {
      if (!ok && reason) {
        /**
         *  Display an error toast if the request is not successful.
         */
        createToast({
          type: 'error',
          ...reason,
        })
      } else if (ok && data) {
        /**
         *  Update the project state with the received data.
         */
        const { xmlSerializedAsObject, filePath } = data
        setCurrentProject({ xmlSerializedAsObject, filePath })
        //   (state: any) => ({
        //   ...state,
        //   xmlSerializedAsObject,
        //   filePath,
        // }))
      }
    },
  })
  /**
   * * Update the invoke function to receive project to save
   */
  const { invoke: sendProjectToSave } = useIpcRender<SendProjectToSaveData>()
  /**
   * Use the `useIpcRender` hook to send a project save request to the renderer process.
   */
  useIpcRender<void, void>({
    channel: get.SAVE_PROJECT,
    /**
     * Callback function for handling the response from the renderer process.
     */
    callback: () => {
      if (!currentProject) return
      sendProjectToSave(set.SAVE_PROJECT, currentProject)
    },
  })

  // * ------------------------------------------------------------------------------------- <- Start from here
  /**
   * Retrieves the XMLSerialized value by the given property path.
   * @param propertyPath The path to the property in the XMLSerialized object.
   * @returns The value at the specified property path.
   */
  const getXmlSerializedValueByPath = useCallback(
    (propertyPath: string): XMLSerializedAsObject | string | undefined => {
      const properties = propertyPath.split('.')
      let xmlSerializedAsObject = { ...currentProject?.xmlSerializedAsObject }

      for (const property of properties) {
        if (
          isObject(xmlSerializedAsObject) &&
          Object.prototype.hasOwnProperty.call(xmlSerializedAsObject, property)
        ) {
          xmlSerializedAsObject = xmlSerializedAsObject[
            property
          ] as XMLSerializedAsObject
        } else {
          return undefined
        }
      }

      return xmlSerializedAsObject
    },
    [currentProject?.xmlSerializedAsObject],
  )
  /**
   * Updates the modification date and time of the project.
   */
  const updateModificationDateTime = useCallback(
    () =>
      ({ pouName, description }: UpdateDocumentationData) => {
        if (currentProject?.xmlSerializedAsObject?.project) {
          const date = formatDate(new Date())

          const project = currentProject.xmlSerializedAsObject
            .project as XMLSerializedAsObject
          /**
           *  Update the modification date and time in the project's contentHeader.
           */
          project.contentHeader = {
            ...(project.contentHeader as XMLSerializedAsObject),
            '@modificationDateTime': date,
          }
        }

        return currentProject
      },
    [currentProject],
  )
  /**
   * Creates a new POU (Program Organization Unit) within the project.
   * @param data The data required to create the POU.
   */
  const createPOU = useCallback(
    ({ name, type, language }: CreatePouData) => {
      setPouData({ name, type, language })
      addPou(programOrganizationUnity)
      // setCurrentProject((state: any) => {
      //   if (!state?.xmlSerializedAsObject && language) return state
      //   updateModificationDateTime()
      //   return {
      //     ...state,
      //     language,
      //     xmlSerializedAsObject: merge(
      //       {
      //         project: {
      //           types: {
      //             pous: {
      //               pou: {
      //                 ...(name && { '@name': name }),
      //                 '@pouType': type,
      //                 body: {
      //                   ...(language && {
      //                     [language]: {
      //                       ...(language === languages.LD && {
      //                         leftPowerRail: {
      //                           '@localId': '1',
      //                           '@heigh': '40',
      //                           '@width': '10',
      //                           position: {
      //                             '@x': '200',
      //                             '@y': '200',
      //                           },
      //                           connectionPointOut: {
      //                             '@formalParameter': '',
      //                             relPosition: {
      //                               '@x': '10',
      //                               '@y': '20',
      //                             },
      //                           },
      //                         },
      //                         rightPowerRail: {
      //                           '@localId': '2',
      //                           '@heigh': '40',
      //                           '@width': '10',
      //                           position: {
      //                             '@x': '800',
      //                             '@y': '200',
      //                           },
      //                           connectionPointIn: {
      //                             relPosition: {
      //                               '@x': '0',
      //                               '@y': '20',
      //                             },
      //                             connection: {
      //                               '@refLocalId': '1',
      //                               position: [
      //                                 {
      //                                   '@x': '800',
      //                                   '@y': '220',
      //                                 },
      //                                 {
      //                                   '@x': '210',
      //                                   '@y': '220',
      //                                 },
      //                               ],
      //                             },
      //                           },
      //                         },
      //                       }),
      //                     },
      //                   }),
      //                 },
      //               },
      //             },
      //           },
      //           instances: {
      //             configurations: {
      //               configuration: {
      //                 resource: {
      //                   task: {
      //                     '@name': 'task0',
      //                     '@priority': '0',
      //                     '@interval': 'T#20ms',
      //                     pouInstance: {
      //                       '@name': 'instance0',
      //                       '@typeName': name,
      //                     },
      //                   },
      //                 },
      //               },
      //             },
      //           },
      //         },
      //       },
      //       state?.xmlSerializedAsObject,
      //     ),
      //   }
      // })
    },
    [addPou, programOrganizationUnity, setPouData],
  )
  /**
   * Updates the documentation of a POU within the project.
   * @param data The data required to update the documentation.
   */
  const updateDocumentation = useCallback(
    ({ pouName, description }: UpdateDocumentationData) => {
      setCurrentProject((state: any) => {
        if (!state?.xmlSerializedAsObject?.project) return state
        const pous = (
          (state.xmlSerializedAsObject.project as XMLSerializedAsObject)
            ?.types as XMLSerializedAsObject
        )?.pous as XMLSerializedAsObject

        Object.keys(pous).forEach((key) => {
          const pou = pous[key] as XMLSerializedAsObject
          if (pou?.['@name'] === pouName) {
            pous[key] = {
              ...pou,
              documentation: {
                'xhtml:p': {
                  $: description,
                },
              },
            }
          }
        })
        updateModificationDateTime()

        return state
      })
    },
    [updateModificationDateTime, setCurrentProject],
  )
  /**
   * Fetches a project from the given path.
   */
  const getProject = useCallback(
    async (path: string) => {
      /**
       *  Use the `invoke` function to send a request to the renderer process.
       */
      const { ok, data, reason } = await invoke(get.PROJECT, path)
      if (!ok && reason) {
        /**
         * Display an error toast if the request is not successful.
         */
        createToast({
          type: 'error',
          ...reason,
        })
      } else if (ok && data) {
        /**
         *  Update the project state with the received data.
         */
        setCurrentProject({
          xmlSerialized: data,
          filePath: path,
        })
      }
    },
    [createToast, invoke, setCurrentProject],
  )
  /**
   * Wrap the children components with the ProjectContext.Provider.
   */
  return (
    <ProjectContext.Provider
      value={{
        currentProject,
        getProject,
        getXmlSerializedValueByPath,
        createPOU,
        updateDocumentation,
      }}
    >
      {children}
    </ProjectContext.Provider>
  )
}

export default ProjectProvider
