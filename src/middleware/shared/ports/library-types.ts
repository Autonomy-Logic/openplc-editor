export type LibraryPouType = 'function' | 'function-block'
export type LibraryLanguage = 'il' | 'st' | 'ld' | 'sfc' | 'fbd'

export interface SystemLibraryVariable {
  name: string
  class: 'input' | 'output' | 'local'
  type:
    | { definition: 'base-type'; value: string }
    | { definition: 'derived-type'; value: string }
    | { definition: 'generic-type'; value: string }
  location?: string
  initialValue?: unknown
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
