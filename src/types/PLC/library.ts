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

const BaseLibraryVariableSchema = z.object({
  name: z.string(),
  class: z.enum(['input', 'output', 'inOut', 'external', 'local']),
  type: z.discriminatedUnion('definition', [
    z.object({
      definition: z.literal('base-type'),
      value: baseTypeSchema,
    }),
    z.object({
      definition: z.literal('derived-type'),
      // This will be overwritten by the derived type schema for the specific library
      value: z.unknown(),
    }),
  ]),
  location: z.string(),
  initialValue: z.lazy((): z.Schema<unknown> => BaseLibraryVariableSchema.pick({ type: true })), // Define the type as a key in the same object
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
  variables: z.array(BaseLibraryVariableSchema),
  language: z.enum(['il', 'st', 'ld', 'sfc', 'fbd']),
  pous: z.array(BaseLibraryVariableSchema),
})

export { DefaultLibrary }
