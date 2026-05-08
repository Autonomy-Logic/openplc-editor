/**
 * Canonical IEC base-type registry — bridge to strucpp's
 * `libs/iec-types.json`.
 *
 * Strucpp owns the elementary type list (sizes, signedness, wire
 * format, PLCopen TC6 XML mapping). The editor reads it here so every
 * downstream consumer — variables-table dropdown, debugger watch panel
 * decoder, force-value encoder, PLCopen XML emitter, zod schemas —
 * gets its facts from the same place. Adding a new IEC type starts in
 * strucpp; once shipped, it surfaces here automatically on the next
 * `npm install` (which copies the JSON into resources/strucpp/libs/).
 *
 * The static import is intentional: zod schemas in this codebase
 * evaluate at module load, and they need the type list synchronously.
 * Webpack bundles the JSON like any other asset; tests pick it up via
 * `resolveJsonModule`.
 */
import iecTypesJson from 'strucpp/libs/iec-types.json'

/**
 * Wire format identifier — the small dispatcher in `variable-sizes.ts`
 * keys off this when decoding bytes off the debugger socket and
 * encoding force values back. Must stay in sync with strucpp's
 * `IECWireFormat` union.
 */
export type IECWireFormat =
  | 'bool'
  | 'int8'
  | 'uint8'
  | 'int16'
  | 'uint16'
  | 'int32'
  | 'uint32'
  | 'int64'
  | 'uint64'
  | 'float32'
  | 'float64'
  | 'duration-ns-i64'
  | 'datetime-ns-i64'
  | 'date-ns-i64'
  | 'tod-ns-i64'
  | 'len8-utf8'
  | 'len8-utf16le'

export interface IECTypeMetadata {
  name: string
  aliases: string[]
  byteSize: number
  bits: number
  signed: boolean | null
  cppType: string
  wireFormat: IECWireFormat
  xml: { elementName: string; plcopenStandard: boolean }
  literalDisplay?: string
}

/**
 * The schemaVersion the editor was built against. If a future
 * strucpp release bumps this, fail loudly at module load instead of
 * silently mis-parsing a renamed field.
 */
const EXPECTED_SCHEMA_VERSION = 1

interface IecTypesFile {
  schemaVersion: number
  elementaryTypes: IECTypeMetadata[]
}

const file = iecTypesJson as IecTypesFile

if (file.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
  throw new Error(
    `iec-types.json schemaVersion mismatch: editor expected ` +
      `${EXPECTED_SCHEMA_VERSION}, got ${file.schemaVersion}. Update the ` +
      `editor to match the new strucpp release.`,
  )
}

export const IEC_BASE_TYPES: readonly IECTypeMetadata[] = file.elementaryTypes

/**
 * Lookup index keyed by canonical name AND every alias, all
 * upper-cased so callers don't have to normalise. Returns the
 * canonical metadata regardless of which spelling went in.
 */
const INDEX: ReadonlyMap<string, IECTypeMetadata> = (() => {
  const m = new Map<string, IECTypeMetadata>()
  for (const t of IEC_BASE_TYPES) {
    m.set(t.name, t)
    for (const alias of t.aliases) m.set(alias, t)
  }
  return m
})()

/**
 * Resolve a name (canonical or alias, any case, with surrounding
 * whitespace) to its metadata. Returns `undefined` for non-elementary
 * names so callers can tell "not in the registry" apart from "wrong
 * field". Trim + upper-case is intentional: legacy project files mix
 * `'STRING'`, `'string'`, and the occasional whitespace-padded value;
 * normalising here means downstream callers don't each re-implement
 * it.
 */
export function lookupBaseType(name: string): IECTypeMetadata | undefined {
  return INDEX.get(name.trim().toUpperCase())
}

/**
 * Whether a name (canonical or alias, any case) is a recognised IEC
 * elementary type. Replaces the per-call `baseTypeSchema.safeParse`
 * pattern.
 */
export function isBaseTypeName(name: string): boolean {
  return INDEX.has(name.trim().toUpperCase())
}

/**
 * Canonical names only (no aliases), in registry order — i.e. the
 * spelling we want to see in UI dropdowns and emit in PLCopen XML.
 */
export const BASE_TYPE_NAMES: readonly string[] = IEC_BASE_TYPES.map((t) => t.name)
