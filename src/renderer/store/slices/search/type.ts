import { z } from 'zod'

const searchModelSchema = z.object({
  pou: z.object({
    name: z.string(),
    language: z.enum(['ld', 'sfc', 'fbd', 'il', 'st']),
    pouType: z.enum(['program', 'function', 'function-block']),
    variable: z.string(),
  }),
  dataType: z.object({
    name: z.string(),
    type: z.enum(['array', 'structure', 'enumerated']),
  }),
  // resource: z.object({
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
