import { CONSTANTS } from '@shared/constants'
import { formatDate } from '@shared/utils'
import { isObject, merge } from 'lodash'
import { useCallback } from 'react'
import { XMLSerializedAsObject } from 'xmlbuilder2/lib/interfaces'

import { useIpcRender, useToast } from '@/hooks'

// $ Types
// ---------------------------------------------------------------- //
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

//  ------------------------------------------------------------------------------------------------  //

// $ Functions and utilities
// ---------------------------------------------------------------- //

// * Simple destruction of createToast function.
const { createToast } = useToast()

// * Extract properties from the imported CONSTANTS object.
const {
  types,
  languages,
  channels: { get, set },
} = CONSTANTS

// ****************************************************************
// $ Get the initial project data and path (Channel: get.PROJECT)
// $ Use the invoke method
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
      //TODO: Create and implement the functionality for updating the project state
      // setProject((state) => ({
      //   ...state,
      //   xmlSerializedAsObject,
      //   filePath,
      // }))
    }
  },
})
// ****************************************************************

// ****************************************************************
// $ Update the invoke method to send the project to save
const { invoke: sendProjectToSave } = useIpcRender<SendProjectToSaveData>()
useIpcRender<void, void>({
  channel: get.SAVE_PROJECT,
  callback: () => {
    if (!project) return
    sendProjectToSave(set.SAVE_PROJECT, project)
  },
})
/**
 * ? Can this be refactored to this?
 * ? const { invoke: sendProjectToSave } = useIpcRender<SendProjectToSaveData>({
 * ?  channel: get.SAVE_PROJECT,
 * ?  callback: () => {
 * ?    if (!project) return
 * ?    sendProjectToSave(set.SAVE_PROJECT, project)
 * ?  }
 * ? })
 */
// ****************************************************************

// ****************************************************************
// $ Retrieve the xml file as an object using the project path
const getXmlSerializedValueByPath = useCallback(
  //TODO: Create and implement the functionality for updating the project state
  (propertyPath: string): XMLSerializedAsObject | string | undefined => {
    const properties = propertyPath.split('.')
    let xmlSerializedAsObject = { ...project?.xmlSerializedAsObject }

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
  [project?.xmlSerializedAsObject],
)
// ****************************************************************

// ****************************************************************
// $ Function to update the modification date and time properties in the xml file
// ? Maybe can be moved to another file?
const updateModificationDateTime = useCallback(
  () =>
    setProject((state) => {
      if (state?.xmlSerializedAsObject?.project) {
        const date = formatDate(new Date())

        const project = state.xmlSerializedAsObject
          .project as XMLSerializedAsObject
        /**
         *  Update the modification date and time in the project's contentHeader.
         */
        project.contentHeader = {
          ...(project.contentHeader as XMLSerializedAsObject),
          '@modificationDateTime': date,
        }
      }

      return state
    }),
  [],
)
// ****************************************************************

// ****************************************************************
// ! Deprecated function to create a new pou, it's now a responsibility of the pouSlice module.
// TODO: Remove unused function.
const createPOU = useCallback(
  ({ name, type, language }: CreatePouData) => {
    setProject((state) => {
      if (!state?.xmlSerializedAsObject && language) return state
      updateModificationDateTime()
      return {
        ...state,
        language,
        xmlSerializedAsObject: merge(
          {
            project: {
              types: {
                pous: {
                  pou: {
                    ...(name && { '@name': name }),
                    '@pouType': type,
                    body: {
                      ...(language && {
                        [language]: {
                          ...(language === languages.LD && {
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
                          }),
                        },
                      }),
                    },
                  },
                },
              },
              instances: {
                configurations: {
                  configuration: {
                    resource: {
                      task: {
                        '@name': 'task0',
                        '@priority': '0',
                        '@interval': 'T#20ms',
                        pouInstance: {
                          '@name': 'instance0',
                          '@typeName': name,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          state?.xmlSerializedAsObject,
        ),
      }
    })
  },
  [updateModificationDateTime],
)
// ****************************************************************

// ****************************************************************
// $ Function to update the description of a single pou.
// ? Is it a needed function?
const updateDocumentation = useCallback(
  ({ pouName, description }: UpdateDocumentationData) => {
    setProject((state) => {
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
  [updateModificationDateTime],
)
// ****************************************************************

// ****************************************************************
// $ Function to get the current project from the actual path.
// ? This is being repeated? - The first invoke function seems to do the same thing.
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
      setProject((state) => ({
        ...state,
        xmlSerialized: data,
        filePath: path,
      }))
    }
  },
  [createToast, invoke],
)
// ****************************************************************

const createProjectSlice = () => {}
export default createProjectSlice
