import z from 'zod'

const LibraryVariableSchema = z.object({
  name: z.string(),
})

const DefaultLibrary = z.object({
  name: z.string(),
  author: z.string(),
  version: z.string(),
  'st-path': z.string(), // Path to the txt file
  'c-path': z.string(), // Path to the C file
  'data-types': z.array(z.string()), // List of data types
  pous: z.array(LibraryVariableSchema),
})

export { DefaultLibrary }
