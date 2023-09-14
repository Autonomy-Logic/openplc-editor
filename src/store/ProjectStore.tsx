import React, { createContext, useRef } from 'react'
import { createStore } from 'zustand'

export interface ProjectProps {
  project: object
}

export interface ProjectState extends ProjectProps {
  addSomething: () => void
}

export type ProjectStore = ReturnType<typeof createProjectStore>

const createProjectStore = (initProps?: Partial<ProjectProps>) => {
  const DEFAULT_PROPS: ProjectProps = { project: { name: 'name' } }
  return createStore<ProjectState>()((set) => ({
    ...DEFAULT_PROPS,
    ...initProps,
    addSomething: () =>
      set((state) => ({
        project: { ...state.project, name: 'nameModified' },
      })),
  }))
}

export const Project2Context = createContext<ProjectStore | null>(null)

type ProjectProviderWithProps = React.PropsWithChildren<ProjectProps>

const Project2Provider = ({ children, ...props }: ProjectProviderWithProps) => {
  const storeRef = useRef<ProjectStore>()
  if (!storeRef.current) {
    storeRef.current = createProjectStore(props)
  }

  return (
    <Project2Context.Provider value={storeRef.current}>
      {children}
    </Project2Context.Provider>
  )
}

export default Project2Provider
