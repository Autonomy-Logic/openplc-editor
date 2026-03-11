import type { PLCVariable } from '../../../../middleware/shared/ports/types'

export type LibraryPouType = 'function' | 'function-block'
export type LibraryLanguage = 'il' | 'st' | 'ld' | 'sfc' | 'fbd'

export interface SystemLibraryVariable {
  name: string
  class: 'input' | 'output' | 'local'
  type: { definition: 'base-type'; value: string }
  location?: string
  initialValue?: string | null
  documentation?: string
}

export interface SystemLibraryPou {
  name: string
  type: LibraryPouType
  language: LibraryLanguage
  variables: SystemLibraryVariable[]
  body: string
  documentation: string
  extensible?: boolean
}

export interface SystemLibrary {
  name: string
  author: string
  version: string
  stPath: string
  cPath: string
  pous: SystemLibraryPou[]
}

export interface UserLibrary {
  name: string
  type: 'function' | 'function-block' | 'program'
}

export type LibraryState = {
  libraries: {
    system: SystemLibrary[]
    user: UserLibrary[]
  }
}

export type LibraryActions = {
  setSystemLibraries: (libraries: SystemLibrary[]) => void
  addLibrary: (name: string, type: 'function' | 'function-block') => void
  updateLibraryName: (name: string, newName: string) => void
  clearUserLibraries: () => void
  removeUserLibrary: (name: string) => void
}

export type LibrarySlice = LibraryState & {
  libraryActions: LibraryActions
}
