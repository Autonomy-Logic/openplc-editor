import { z } from 'zod'

const libraryStateSchema = z.object({
  libraries: z.object({
    system: z.array(z.string()), // This is the libraries that are built-in to the system
    user: z.array(z.string()), // This is the libraries that the user has installed
  }),
})

const libraryActionsSchema = z.object({
  addLibrary: z.function().args(z.string()).returns(z.void()),
  removeLibrary: z.function().args(z.string()).returns(z.void()),
})

type LibraryState = z.infer<typeof libraryStateSchema>
type LibraryActions = z.infer<typeof libraryActionsSchema>
type LibrarySlice = LibraryState & {
  libraryActions: LibraryActions
}

export { libraryActionsSchema,libraryStateSchema }
export type { LibraryActions, LibrarySlice, LibraryState }
