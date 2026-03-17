export type {
  LibraryLanguage,
  LibraryPouType,
  LibraryState,
  SystemLibrary,
  SystemLibraryPou,
  SystemLibraryVariable,
  UserLibrary,
} from '../../../../middleware/shared/ports/library-types'

import type { SystemLibrary } from '../../../../middleware/shared/ports/library-types'

export type LibraryActions = {
  setSystemLibraries: (libraries: SystemLibrary[]) => void
  addLibrary: (name: string, type: 'function' | 'function-block') => void
  updateLibraryName: (name: string, newName: string) => void
  clearUserLibraries: () => void
  removeUserLibrary: (name: string) => void
}

export type LibrarySlice = import('../../../../middleware/shared/ports/library-types').LibraryState & {
  libraryActions: LibraryActions
}
