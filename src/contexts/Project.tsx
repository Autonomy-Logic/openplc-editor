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
