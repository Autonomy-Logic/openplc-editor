import { useContext } from 'react'
import { useStore } from 'zustand'

import { Project2Context, ProjectState } from './ProjectStore'

function useProject2Context<T>(selector: (state: ProjectState) => T): T {
  const store = useContext(Project2Context)
  if (!store) throw new Error('Missing context provider in tree')
  return useStore(store, selector)
}

export default useProject2Context
