import z from 'zod'

const baseTypeSchema = z.enum([
  'BOOL',
  'SINT',
  'INT',
  'DINT',
  'LINT',
  'USINT',
  'UINT',
  'UDINT',
  'ULINT',
  'REAL',
  'LREAL',
  'TIME',
  'DATE',
  'TOD',
  'DT',
  'STRING',
  'BYTE',
  'WORD',
  'DWORD',
  'LWORD',
  'LOGLEVEL',
])

const LibraryVariableSchema = z.object({
  name: z.string(),
  class: z.enum(['input', 'output', 'inOut', 'external', 'local']),
  type: z.discriminatedUnion('definition', [
    z.object({
      definition: z.literal('base-type'),
      value: baseTypeSchema,
    }),
    z.object({
      definition: z.literal('derived-type'),
    //  value: z.Schema(),
    }),
  ]),
  location: z.string(),
  // initialValue: z.string().optional(),
  documentation: z.string(),
  debug: z.boolean(),
})

const DefaultLibrary = z.object({
  name: z.string(),
  author: z.string(),
  version: z.string(),
  stPath: z.string(), // Path to the txt file
  cPath: z.string(), // Path to the C file
  dataTypes: z.array(z.string()), // List of data types
  pous: z.array(LibraryVariableSchema),
})

export { DefaultLibrary }
