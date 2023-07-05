import { CONSTANTS } from '@shared/constants'
import { merge } from 'lodash'
import {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useState,
} from 'react'

import { useIpcRender, useToast } from '@/hooks'

const {
  types,
  languages,
  channels: { get },
} = CONSTANTS

type XmlSerialized = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

type ProjectProps = {
  language?: (typeof languages)[keyof typeof languages]
  xmlSerialized?: XmlSerialized
}

type CreatePouDataProps = {
  name?: string
  type: (typeof types)[keyof typeof types]
  language?: (typeof languages)[keyof typeof languages]
}

type GetProjectProps = {
  ok: boolean
  reason?: { title: string; description?: string }
  data?: ProjectProps
}

export type ProjectContextData = {
  project?: ProjectProps
  getProject: (path: string) => Promise<void>
  createPOU: (data: CreatePouDataProps) => void
}

export const ProjectContext = createContext<ProjectContextData>(
  {} as ProjectContextData,
)

// TODO: Remove mock project

const mockProject = {
  language: 'LD',
  xmlSerialized: {
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
              LD: {},
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
        setProject((state) => ({ ...state, xmlSerialized: data }))
      }
    },
  })

  const createPOU = useCallback(
    ({ name, type, language }: CreatePouDataProps) =>
      setProject((state) => ({
        language,
        xmlSerialized: merge(state?.xmlSerialized, {
          project: {
            types: {
              pous: {
                pou: {
                  ...(name && { '@name': name }),
                  '@pouType': type,
                  body: {
                    ...(language && { [language]: {} }),
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
        }),
      })),
    [],
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
        setProject((state) => ({ ...state, xmlSerialized: data }))
      }
    },
    [createToast, invoke],
  )

  return (
    <ProjectContext.Provider value={{ project, getProject, createPOU }}>
      {children}
    </ProjectContext.Provider>
  )
}

export default ProjectProvider
