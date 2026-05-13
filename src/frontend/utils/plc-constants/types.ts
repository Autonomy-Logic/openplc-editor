/**
 * PLC domain constants — IEC 61131-3 language definitions.
 *
 * Base-type lists used to live here too. They've moved to the
 * canonical strucpp registry (`../iec-types-registry.ts`) — re-export
 * is for backwards-compat with the import path `baseTypes` callers use
 * to seed zod schemas. New code should import directly from the
 * registry.
 */
import { BASE_TYPE_NAMES } from '../iec-types-registry'

/**
 * Canonical IEC 61131-3 base type names (no aliases — `TIME_OF_DAY`
 * resolves to `TOD`, `DATE_AND_TIME` to `DT`). Sourced from
 * strucpp's `libs/iec-types.json` at build time.
 */
const baseTypes: readonly string[] = BASE_TYPE_NAMES

/**
 * String alias for IEC base type names. Loaded from JSON at runtime so
 * the value-side `as const` literal narrowing is no longer available;
 * callers that need narrowing should use `isBaseTypeName` from the
 * registry as a runtime guard.
 */
type PLCBaseType = string

const PLCLanguagesShortenedForm = ['IL', 'ST', 'LD', 'FBD', 'SFC'] as const

const PLCFunctionBlockLanguages = ['IL', 'ST', 'LD', 'FBD', 'SFC', 'python', 'cpp'] as const

const PLCFunctionLanguages = ['IL', 'ST', 'LD', 'FBD', 'SFC'] as const

const PLCProgramLanguages = ['IL', 'ST', 'LD', 'FBD', 'SFC'] as const

const PLCLanguages = [
  'instruction-list',
  'structured-text',
  'ladder-diagram',
  'function-block-diagram',
  'sequential-function-chart',
] as const

export {
  baseTypes,
  PLCFunctionBlockLanguages,
  PLCFunctionLanguages,
  PLCLanguages,
  PLCLanguagesShortenedForm,
  PLCProgramLanguages,
}
export type { PLCBaseType }
