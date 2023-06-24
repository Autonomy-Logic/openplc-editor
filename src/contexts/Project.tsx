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
  channels: { get, set },
} = CONSTANTS

type XmlSerialized = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

type ProjectProps = {
  language?: keyof typeof languages
  xmlSerialized?: XmlSerialized
}

type CreatePouDataProps = {
  name: string
  type: keyof typeof types
  language: keyof typeof languages
}

type GetProjectProps = {
  ok: boolean
  reason?: { title: string; description?: string }
  data?: ProjectProps
}

export type ProjectContextData = {
  project?: ProjectProps
  getProject: (path: string) => Promise<void>
}

export const ProjectContext = createContext<ProjectContextData>(
  {} as ProjectContextData,
)

const ProjectProvider: FC<PropsWithChildren> = ({ children }) => {
  const [project, setProject] = useState<ProjectProps>()
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

  useIpcRender<undefined, CreatePouDataProps>({
    channel: set.CREATE_POU_DATA,
    callback: ({ name, type, language }) =>
      setProject((state) => ({
        language,
        xmlSerialized: merge(state?.xmlSerialized, {
          project: {
            types: {
              pous: {
                pou: {
                  '@name': name,
                  '@pouType': type,
                  body: {
                    [language]: {},
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
  })

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
    <ProjectContext.Provider value={{ project, getProject }}>
      {children}
    </ProjectContext.Provider>
  )
}

export default ProjectProvider
