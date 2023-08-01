import { CONSTANTS } from '@shared/constants'
import { formatDate } from '@shared/utils'
import { isObject, merge } from 'lodash'
import {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useState,
} from 'react'
import { XMLSerializedAsObject } from 'xmlbuilder2/lib/interfaces'

import { useIpcRender, useToast } from '@/hooks'

const {
  types,
  languages,
  channels: { get, set },
} = CONSTANTS

type ProjectProps = {
  language?: (typeof languages)[keyof typeof languages]
  xmlSerializedAsObject?: XMLSerializedAsObject
  filePath?: string
}

type CreatePouData = {
  name?: string
  type: (typeof types)[keyof typeof types]
  language?: (typeof languages)[keyof typeof languages]
}

type SendProjectToSaveData = {
  project?: XMLSerializedAsObject
  filePath?: string
}

type UpdateDocumentationData = {
  pouName: string
  description: string
}

type GetProjectProps = {
  ok: boolean
  reason?: { title: string; description?: string }
  data?: ProjectProps
}

export type ProjectContextData = {
  project?: ProjectProps
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
const mockProject: ProjectProps = {
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

const ProjectProvider: FC<PropsWithChildren> = ({ children }) => {
  const [project, setProject] = useState<ProjectProps>(mockProject)
  const { createToast } = useToast()
  const { invoke } = useIpcRender<string, GetProjectProps>({
    channel: get.PROJECT,
    callback: ({ ok, data, reason }) => {
      if (!ok && reason) {
        createToast({
          type: 'error',
          ...reason,
        })
      } else if (ok && data) {
        const { xmlSerializedAsObject, filePath } = data
        setProject((state) => ({
          ...state,
          xmlSerializedAsObject,
          filePath,
        }))
      }
    },
  })

  const { invoke: sendProjectToSave } = useIpcRender<SendProjectToSaveData>()

  useIpcRender<void, void>({
    channel: get.SAVE_PROJECT,
    callback: () => {
      if (!project) return
      sendProjectToSave(set.SAVE_PROJECT, project)
    },
  })

  const getXmlSerializedValueByPath = useCallback(
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

  const updateModificationDateTime = useCallback(
    () =>
      setProject((state) => {
        if (state?.xmlSerializedAsObject?.project) {
          const date = formatDate(new Date())

          const project = state.xmlSerializedAsObject
            .project as XMLSerializedAsObject

          project.contentHeader = {
            ...(project.contentHeader as XMLSerializedAsObject),
            '@modificationDateTime': date,
          }
        }

        return state
      }),
    [],
  )

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

  const getProject = useCallback(
    async (path: string) => {
      const { ok, data, reason } = await invoke(get.PROJECT, path)
      if (!ok && reason) {
        createToast({
          type: 'error',
          ...reason,
        })
      } else if (ok && data) {
        setProject((state) => ({
          ...state,
          xmlSerialized: data,
          filePath: path,
        }))
      }
    },
    [createToast, invoke],
  )

  return (
    <ProjectContext.Provider
      value={{
        project,
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
