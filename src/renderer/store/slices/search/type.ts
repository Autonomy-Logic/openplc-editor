import { z } from 'zod'

// project -> function -> pou -> variable

const searchModelSchema = z.object({
  type: z.enum(['plc-function', 'plc-graphical', 'plc-datatype', 'plc-resource']),
  pou: z.object({
    name: z.string(),
    language: z.enum(['ld', 'sfc', 'fbd', 'il', 'st']),
    pouType: z.enum(['program', 'function', 'function-block']),
    variable: z.string(),
  }),
})

const projectSchema = z.object({
  searchQuery: z.string(),
  projectName: z.string(),
  functions: z.array(searchModelSchema),
})
type Project = z.infer<typeof projectSchema>

const searchStateSchema = z.object({
  searchQuery: z.string(),
  searchResults: z.array(projectSchema),
})
type SearchState = z.infer<typeof searchStateSchema>

const searchActionsSchema = z.object({
  setSearchQuery: z.function().args(z.string()).returns(z.void()),
  setSearchResults: z.function().args(projectSchema).returns(z.void()),
  removeSearchResult: z.function().args(z.number()).returns(z.void()),
})
type SearchActions = z.infer<typeof searchActionsSchema>

type SearchSlice = SearchState & { searchActions: SearchActions }

export type { Project, SearchSlice, SearchState }
