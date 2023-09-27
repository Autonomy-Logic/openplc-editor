import { CONSTANTS } from '@shared/constants'
import { formatDate } from '@shared/utils'
import { isObject } from 'lodash'
import { createContext, FC, PropsWithChildren, useCallback } from 'react'
import { XMLSerializedAsObject } from 'xmlbuilder2/lib/interfaces'
import { useStore } from 'zustand'

import { xmlProject } from '@/@types/xmlProject'
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
  xmlSerializedAsObject?: XMLSerializedAsObject | xmlProject
  filePath?: string
}
/**
 * Represents the data needed to create a new POU.
 */
type CreatePouData = {
  name: string
  type: (typeof types)[keyof typeof types]
  language?: (typeof languages)[keyof typeof languages]
}
/**
 * Represents the data needed to send a project for saving.
 */
type SendProjectToSaveData = {
  project?: XMLSerializedAsObject | xmlProject
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
  ) => XMLSerializedAsObject | xmlProject | string
  getProject: (path: string) => Promise<void>
  createProgramOrganizationUnit: (data: CreatePouData) => void
  updateDocumentation?: (data: UpdateDocumentationData) => void
}

export const ProjectContext = createContext<ProjectContextData>(
  {} as ProjectContextData,
)

/**
 * Provides the project context to the application.
 * @param children The children components wrapped by the context provider.
 * @returns A JSX Component with the project context provider
 */
const ProjectProvider: FC<PropsWithChildren> = ({ children }) => {
  const {
    filePath,
    projectXmlAsObj,
    setWorkspaceProject,
    // updateDateTime,
    addPouInProject,
  } = useStore(projectStore)
  const { pous, createNewPou } = useStore(pouStore)
  /**
   * Define state to hold project data and a function to update it.
   */
  // const [project, setProject] = useState<ProjectProps>(mockProject)
  /**
   * Destructure the createToast function from the useToast hook.
   */
  const { createToast } = useToast()

  /**
   * && Experimental: --------------------------------------------------------------- Start Block.
   * * Refactor format for invoke callback interaction with getProject function
   */

  // Success: Implemented.
  // Function to handle response and display error toast
  const handleResponse = useCallback(
    ({ ok, data, reason }: GetProjectProps) => {
      if (!ok && reason) {
        createToast({ type: 'error', ...reason })
      } else if (ok && data) {
        const { xmlSerializedAsObject, filePath } = data
        setWorkspaceProject({
          projectXmlAsObj: xmlSerializedAsObject as xmlProject,
          filePath: filePath ?? '',
        })
      }
    },
    [createToast, setWorkspaceProject],
  )

  const { invoke } = useIpcRender<string, GetProjectProps>({
    channel: get.PROJECT,
    callback: handleResponse,
  })

  // todo: Resolve this code block
  // ? What is missing? What is doing?

  const getProject = useCallback(
    async (path: string) => {
      try {
        const response = await invoke(get.PROJECT, path)
        handleResponse(response)
      } catch (error) {
        // Handle any other errors if needed
        console.error(error)
      }
    },
    [handleResponse, invoke],
  )

  // && Experimental: Create a new POU using projectStore
  /**
   * Updates the modification date and time of the project.
   */
  // const updateModificationDateTime = useCallback(
  //   () => updateDateTime(new Date().toISOString()),
  // setWorkspaceProject({
  //   projectXmlAsObj: {
  //     ...projectXmlAsObj,
  //     fileHeader: {
  //       ...projectXmlAsObj.fileHeader,
  //       '@modificationDateTime': new Date().toISOString(),
  //     },
  //   },
  // }),
  // ({ pouName, description }: UpdateDocumentationData) => {
  //   if (currentProject?.xmlSerializedAsObject?.project) {
  //     const date = formatDate(new Date())

  //     const project = currentProject.xmlSerializedAsObject
  //       .project as XMLSerializedAsObject
  //     /**
  //      *  Update the modification date and time in the project's contentHeader.
  //      */
  //     project.contentHeader = {
  //       ...(project.contentHeader as XMLSerializedAsObject),
  //       '@modificationDateTime': date,
  //     }
  //   }

  //   return currentProject
  // },
  //   [updateDateTime],
  // )

  // Todo: Create `writePouInXML` function.
  /**
   * Creates a new POU (Program Organization Unit) within the project.
   * @description The produced POU is initially added to application memory and is only written to XML when the `writePouInXML` method is used.
   * @param data The data required to create the POU.
   */
  const createProgramOrganizationUnit = useCallback(
    ({ name, type, language }: CreatePouData) => {
      addPouInProject({ name: name, type: type, language: language })
      // => {
      //   await getProject(filePath)
      // }
      // const newPouToAddInProject = pous[name]
      // console.log(newPouToAddInProject)
      // if (newPouToAddInProject) {
      //   addPouInProject(newPouToAddInProject)
      //   updateDateTime(new Date().toISOString())
      // }
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
    [addPouInProject],
  )

  /**
   * && Experimental: ------------------------------------------------------------------------------ End Block.
   */
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
      if (!filePath || !projectXmlAsObj) return
      sendProjectToSave(set.SAVE_PROJECT, {
        project: projectXmlAsObj,
        filePath,
      })
    },
  })

  // * ------------------------------------------------------------------------------------- <- Start from here
  /**
   * Retrieves the XMLSerialized value by the given property path.
   * @param propertyPath The path to the property in the XMLSerialized object.
   * @returns The value at the specified property path.
   */
  const getXmlSerializedValueByPath = useCallback(
    (propertyPath: string): XMLSerializedAsObject | string | xmlProject => {
      const properties = propertyPath.split('.')
      let xmlSerializedAsObject: XMLSerializedAsObject =
        projectXmlAsObj as XMLSerializedAsObject
      for (const property of properties) {
        if (
          isObject(xmlSerializedAsObject) &&
          Object.prototype.hasOwnProperty.call(xmlSerializedAsObject, property)
        ) {
          xmlSerializedAsObject = xmlSerializedAsObject[
            property
          ] as XMLSerializedAsObject
        } else {
          return 'Empty XML Serialized'
        }
      }
      console.log(
        'getXmlSerializedValueByPath function -> ',
        xmlSerializedAsObject,
      )

      return xmlSerializedAsObject
    },
    [projectXmlAsObj],
  )

  const addProgramCreatedInProject = ''
  /**
   * Updates the documentation of a POU within the project.
   * @param data The data required to update the documentation.
   */
  // const updateDocumentation = useCallback(
  //   ({ pouName, description }: UpdateDocumentationData) => {
  //     setCurrentProject((state: any) => {
  //       if (!state?.xmlSerializedAsObject?.project) return state
  //       const pous = (
  //         (state.xmlSerializedAsObject.project as XMLSerializedAsObject)
  //           ?.types as XMLSerializedAsObject
  //       )?.pous as XMLSerializedAsObject

  //       Object.keys(pous).forEach((key) => {
  //         const pou = pous[key] as XMLSerializedAsObject
  //         if (pou?.['@name'] === pouName) {
  //           pous[key] = {
  //             ...pou,
  //             documentation: {
  //               'xhtml:p': {
  //                 $: description,
  //               },
  //             },
  //           }
  //         }
  //       })
  //       updateModificationDateTime()

  //       return state
  //     })
  //   },
  //   [updateModificationDateTime, setCurrentProject],
  // )
  /**
   * Fetches a project from the given path.
   */

  // ! Creates a block for invoke and getProject function during experimental implementation.
  // /**
  //  * Use the useIpcRender hook to invoke a renderer process event.
  //  */
  // const { invoke } = useIpcRender<string, GetProjectProps>({
  //   channel: get.PROJECT,
  //   /**
  //    * Callback function for handling the response from the renderer process.
  //    */
  //   callback: ({ ok, data, reason }) => {
  //     if (!ok && reason) {
  //       /**
  //        *  Display an error toast if the request is not successful.
  //        */
  //       createToast({
  //         type: 'error',
  //         ...reason,
  //       })
  //     } else if (ok && data) {
  //       /**
  //        *  Update the project state with the received data.
  //        */
  //       const { xmlSerializedAsObject, filePath } = data
  //       setWorkspaceProject({
  //         projectXmlAsObj: xmlSerializedAsObject,
  //         filePath,
  //       })
  //       //   (state: any) => ({
  //       //   ...state,
  //       //   xmlSerializedAsObject,
  //       //   filePath,
  //       // }))
  //     }
  //   },
  // })

  // const getProject = useCallback(
  //   async (path: string) => {
  //     /**
  //      *  Use the `invoke` function to send a request to the renderer process.
  //      */
  //     const { ok, data, reason } = await invoke(get.PROJECT, path)
  //     if (!ok && reason) {
  //       /**
  //        * Display an error toast if the request is not successful.
  //        */
  //       createToast({
  //         type: 'error',
  //         ...reason,
  //       })
  //     } else if (ok && data) {
  //       /**
  //        *  Update the project state with the received data.
  //        */

  //       setCurrentProject({
  //         xmlSerialized: data,
  //         filePath: path,
  //       })
  //     }
  //   },
  //   [createToast, invoke, setCurrentProject],
  // )
  /**
   * Wrap the children components with the ProjectContext.Provider.
   */
  return (
    <ProjectContext.Provider
      value={{
        // currentProject,
        getProject,
        getXmlSerializedValueByPath,
        createProgramOrganizationUnit,
        // updateDocumentation,
      }}
    >
      {children}
    </ProjectContext.Provider>
  )
}

export default ProjectProvider
