/**
 * This file contains schemas to validate the shape of the libraries in the OpenPLC project.
 * The libraries are used to define the functions and function blocks that will be used in the PLC.
 * The schemas are defined here using Zod, but isn't being instantiated. This will be done in the Library file.
 * The following schemas are defined: BaseLibrarySchema, BaseLibraryPouSchema, BaseLibraryVariableSchema.
 *
 * The schemas can be extended to add more properties, or modify the existent if needed.
 * @author: Autonomy Logic
 */
import z from 'zod'

/**
 * This is the basic types common to all the libraries.
 */
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

const genericTypeSchema = z.object({
  ANY: z.union([
    baseTypeSchema,
    z.literal('ANY_INT'),
    z.literal('ANY_BIT'),
    z.literal('ANY_STRING'),
    z.literal('ANY_REAL'),
    z.literal('ANY_DATE'),
    z.literal('ANY_LOGLEVEL'),
    z.literal('ANY_CHAR'),
    z.literal('ANY_CHARS'),
    z.literal('ANY_NUM'),
    z.literal('ANY_INTEGRAL'),
    z.literal('ANY_SIGNED'),
    z.literal('ANY_UNSIGNED'),
    z.literal('ANY_MAGNITUDE'),
    z.literal('ANY_ELEMENTARY'),
  ]),
  ANY_INT: baseTypeSchema.extract(['SINT', 'INT', 'DINT', 'LINT', 'USINT', 'UINT', 'UDINT', 'ULINT']),
  ANY_BIT: baseTypeSchema.extract(['BOOL', 'BYTE', 'WORD', 'DWORD', 'LWORD']),
  ANY_STRING: baseTypeSchema.extract(['STRING']),
  ANY_REAL: baseTypeSchema.extract(['REAL', 'LREAL']),
  ANY_DATE: baseTypeSchema.extract(['TIME', 'DATE', 'TOD', 'DT']),
  ANY_LOGLEVEL: baseTypeSchema.extract(['LOGLEVEL']),
  ANY_CHAR: z.enum(['CHAR', 'WCHAR']),
  ANY_CHARS: z.union([z.literal('ANY_CHAR'), z.array(z.literal('ANY_STRING'))]), // Should be reviewed
  ANY_NUM: z.union([z.literal('ANY_INT'), z.literal('ANY_REAL')]),
  ANY_INTEGRAL: z.union([z.literal('ANY_INT'), z.literal('ANY_BIT')]),
  ANY_SIGNED: baseTypeSchema.extract(['SINT', 'INT', 'DINT', 'LINT']),
  ANY_UNSIGNED: baseTypeSchema.extract(['USINT', 'UINT', 'UDINT', 'ULINT']),
  ANY_MAGNITUDE: z.union([z.literal('ANY_REAL'), z.literal('ANY_INT'), z.literal('TIME')]),
  ANY_ELEMENTARY: z.union([z.literal('ANY_MAGNITUDE'), z.literal('ANY_BIT'), z.literal('ANY_CHARS'), z.literal('ANY_DATE')]),
})

/**
 * This schema defines the structure of the variables that are used in the functions and function blocks.
 */
const BaseLibraryVariableSchema = z.object({
  name: z.string(),
  class: z.enum(['input', 'output', 'local']), // This can be reviewed if needed.
  type: z.object({
    definition: z.literal('base-type'),
    value: baseTypeSchema,
  }), // In some especial cases, this can be a complex type.
  location: z.string().optional(), // TODO: Add a regex to validate the location.
  initialValue: z.lazy((): z.Schema<unknown> => BaseLibraryVariableSchema.pick({ type: true })).optional(), // Define the type as a key in the same object
  documentation: z.string().optional(),
})

/**
 * This schema defines the structure of the functions and function blocks that are used in the PLC.
 */
const BaseLibraryPouSchema = z.object({
  name: z.string(),
  type: z.enum(['function', 'function-block']), // This can be reviewed if needed.
  language: z.enum(['il', 'st', 'ld', 'sfc', 'fbd']), // This can be reviewed if needed, possibly only ST will be used.
  variables: z.array(BaseLibraryVariableSchema),
  body: z.string(),
  documentation: z.string(),
  extensible: z.boolean().optional(),
})

/**
 * This schema defines the structure of the libraries that are used in the PLC.
 */
const BaseLibrarySchema = z.object({
  name: z.string(),
  author: z.string(),
  version: z.string(),
  stPath: z.string(), // Path to the txt file
  cPath: z.string(), // Path to the C file
  // dataTypes: z.array(z.string()), // List of data types
  // variables: z.array(BaseLibraryVariableSchema),
  pous: z.array(BaseLibraryPouSchema),
})

export { BaseLibraryPouSchema, BaseLibrarySchema, BaseLibraryVariableSchema, baseTypeSchema, genericTypeSchema }
