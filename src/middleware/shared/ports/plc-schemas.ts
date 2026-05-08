/**
 * PLC Type System — Zod schemas for validating PLC base types, generic types, and library POUs.
 *
 * These schemas are platform-agnostic and shared between both repos.
 * Used by the graphical editor (FBD/Ladder) to validate block variants and variable types.
 *
 * Replaces:
 *   Editor: src/types/PLC/units/library.ts
 *   Web:    src/store/types/PLC/units/library.ts
 */
import { BASE_TYPE_NAMES } from '@root/frontend/utils/iec-types-registry'
import z from 'zod'

/**
 * Base PLC types common to all libraries — derived from strucpp's
 * canonical `libs/iec-types.json`. The narrow `[string, ...string[]]`
 * cast is what `z.enum` requires for non-empty literal lists; the
 * registry guarantees the array has ≥ 1 entry.
 */
const baseTypeSchema = z.enum(BASE_TYPE_NAMES as unknown as [string, ...string[]])

const genericTypeSchema = z.object({
  ANY: z.union([
    baseTypeSchema,
    z.literal('ANY_INT'),
    z.literal('ANY_BIT'),
    z.literal('ANY_STRING'),
    z.literal('ANY_REAL'),
    z.literal('ANY_DATE'),
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
  ANY_CHAR: z.enum(['CHAR', 'WCHAR']),
  ANY_CHARS: z.union([z.literal('ANY_CHAR'), z.array(z.literal('ANY_STRING'))]),
  ANY_NUM: z.union([z.literal('ANY_INT'), z.literal('ANY_REAL')]),
  ANY_INTEGRAL: z.union([z.literal('ANY_INT'), z.literal('ANY_BIT')]),
  ANY_SIGNED: baseTypeSchema.extract(['SINT', 'INT', 'DINT', 'LINT']),
  ANY_UNSIGNED: baseTypeSchema.extract(['USINT', 'UINT', 'UDINT', 'ULINT']),
  ANY_MAGNITUDE: z.union([z.literal('ANY_REAL'), z.literal('ANY_INT'), z.literal('TIME')]),
  ANY_ELEMENTARY: z.union([
    z.literal('ANY_MAGNITUDE'),
    z.literal('ANY_BIT'),
    z.literal('ANY_CHARS'),
    z.literal('ANY_DATE'),
  ]),
})

/**
 * Schema for variables used in library functions and function blocks.
 */
const BaseLibraryVariableSchema = z.object({
  name: z.string(),
  class: z.enum(['input', 'output', 'local']),
  type: z.object({
    definition: z.literal('base-type'),
    value: baseTypeSchema,
  }),
  location: z.string().optional(),
  initialValue: z.lazy((): z.Schema<unknown> => BaseLibraryVariableSchema.pick({ type: true })).optional(),
  documentation: z.string().optional(),
})

/**
 * Schema for library POU definitions (functions and function blocks).
 */
const BaseLibraryPouSchema = z.object({
  name: z.string(),
  type: z.enum(['function', 'function-block']),
  language: z.enum(['il', 'st', 'ld', 'sfc', 'fbd']),
  variables: z.array(BaseLibraryVariableSchema),
  body: z.string(),
  documentation: z.string(),
  extensible: z.boolean().optional(),
})

export { BaseLibraryPouSchema, BaseLibraryVariableSchema, baseTypeSchema, genericTypeSchema }
