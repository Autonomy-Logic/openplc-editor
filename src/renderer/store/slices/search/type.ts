import { z } from 'zod'

const pouSchema = z.object({
  name: z.string(),
  language: z.enum(['ld', 'sfc', 'fbd', 'il', 'st']),
  pouType: z.enum(['program', 'function', 'function-block']),
  body: z.string(),
  variable: z.string().nullable(),
})

const searchModelSchema = z.object({
  pous: z.record(z.enum(['program', 'function', 'function-block']), z.array(pouSchema)),
  dataTypes: z.array(
    z.object({
      name: z.string(),
      type: z.enum(['array', 'structure', 'enumerated']),
    }),
  ),
  resource: z.object({
    globalVariable: z.string(),
    task: z.string(),
    instance: z.string(),
  }),
})

const projectSchema = z.object({
  searchQuery: z.string(),
  projectName: z.string(),
  functions: searchModelSchema,
  searchCounts: z.number().optional(),
})
type Project = z.infer<typeof projectSchema>

const searchStateSchema = z.object({
  searchQuery: z.string(),
  searchResults: z.array(projectSchema),
  sensitiveCase: z.boolean(),
  regularExpression: z.boolean(),
  searchNodePosition: z.object({ x: z.number(), y: z.number() }),
})
type SearchState = z.infer<typeof searchStateSchema>

const searchActionsSchema = z.object({
  setSearchQuery: z.function().args(z.string()).returns(z.void()),
  setSearchResults: z.function().args(projectSchema).returns(z.void()),
  setSensitiveCase: z.function().args(z.boolean()).returns(z.void()),
  setRegularExpression: z.function().args(z.boolean()).returns(z.void()),
  removeSearchResult: z.function().args(z.number()).returns(z.void()),
  setSearchNodePosition: z
    .function()
    .args(z.object({ x: z.number(), y: z.number() }))
    .returns(z.void()),
})
type SearchActions = z.infer<typeof searchActionsSchema>

type SearchSlice = SearchState & { searchActions: SearchActions }

export type { Project, SearchSlice, SearchState }
