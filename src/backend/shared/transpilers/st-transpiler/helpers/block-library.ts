/**
 * Block-library signatures, sourced from the project's own block variants.
 *
 * openplc-web is co-located with strucpp and the user's installed libraries,
 * so every placed block already carries its full typed signature in
 * `node.data.variant` (the editor stamps it from the library on placement and
 * `restamp-library-variants` keeps it fresh). The transpiler resolves block
 * types from those variants — the same source `collect-library-blocks.ts`
 * feeds the Python oracle as the embedded `<libraryBlocks>` payload — instead
 * of bundling a separate catalog. Unknown blocks degrade to permissive
 * synthesis in `connection-types.ts`.
 */

export interface BlockIO {
  name: string
  type: string
  qualifier: 'none' | 'negated' | 'rising' | 'falling'
}

export interface BlockInfos {
  name: string
  type: 'function' | 'functionBlock' | 'program' | string
  extensible: boolean
  inputs: BlockIO[]
  outputs: BlockIO[]
  comment: string
  usage: string
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Build a block signature from a placed block's `node.data.variant`.
 *
 * Mirrors `collect-library-blocks.ts` / xml2st's `_pou_to_block_infos`:
 * EN/ENO are implicit control pins (dropped); inOut params appear on both
 * sides; a function's return is already a class-`output` variable named `OUT`.
 * Generic IEC meta-types (`ANY`, `ANY_NUM`, …) are kept verbatim and resolved
 * from the wired connections during type inference.
 */
export function blockInfosFromVariant(variant: unknown): BlockInfos | null {
  if (!isRecord(variant)) return null
  const name = typeof variant.name === 'string' ? variant.name : null
  if (name === null) return null

  const inputs: BlockIO[] = []
  const outputs: BlockIO[] = []
  const variables = Array.isArray(variant.variables) ? variant.variables : []
  for (const v of variables) {
    if (!isRecord(v)) continue
    const vName = typeof v.name === 'string' ? v.name : null
    if (vName === null || vName === 'EN' || vName === 'ENO') continue
    const type = isRecord(v.type) && typeof v.type.value === 'string' ? v.type.value : 'ANY'
    const io: BlockIO = { name: vName, type, qualifier: 'none' }
    if (v.class === 'input') inputs.push(io)
    else if (v.class === 'output') outputs.push(io)
    else if (v.class === 'inOut' || v.class === 'inout') {
      inputs.push(io)
      outputs.push(io)
    }
  }

  return {
    name,
    type:
      variant.type === 'function-block' || variant.type === 'function-block-instance' ? 'functionBlock' : 'function',
    extensible: variant.extensible === true,
    inputs,
    outputs,
    comment: '',
    usage: '',
  }
}

/**
 * Destination types of the IEC 61131-3 polymorphic conversion family
 * (`TO_BOOL`, `TO_INT`, `TO_UINT`, …). Kept explicit so additions to the
 * supported compiler conversion family remain visible in code review.
 */
export const TO_CONVERSION_TARGETS: ReadonlySet<string> = new Set([
  'BCD',
  'BOOL',
  'BYTE',
  'DATE',
  'DINT',
  'DT',
  'DWORD',
  'INT',
  'LINT',
  'LREAL',
  'LWORD',
  'REAL',
  'SINT',
  'STRING',
  'TIME',
  'TOD',
  'UDINT',
  'UINT',
  'ULINT',
  'USINT',
  'WORD',
])

const TEMPORAL_TYPES: ReadonlySet<string> = new Set(['DATE', 'DT', 'TIME', 'TOD'])
const UNSIGNED_INTEGER_TYPES: ReadonlySet<string> = new Set(['UDINT', 'UINT', 'ULINT', 'USINT'])
const GENERAL_CONVERSION_TARGETS: ReadonlySet<string> = new Set([
  'BYTE',
  'DINT',
  'DWORD',
  'INT',
  'LINT',
  'LREAL',
  'LWORD',
  'REAL',
  'SINT',
  'STRING',
  'UDINT',
  'UINT',
  'ULINT',
  'USINT',
  'WORD',
])

/**
 * Resolve a polymorphic `TO_<TYPE>` block name (e.g. `TO_INT`) to the
 * concrete, fully-qualified IEC 61131-3 conversion function (e.g.
 * `REAL_TO_INT`) given the type of whatever is wired into its single
 * input.
 *
 * IEC 61131-3 does not define a generic `TO_INT` — only the fully
 * qualified `<SRC>_TO_<DST>` family exists. A block instance whose type name
 * is still the generic shorthand at code-generation time hasn't been
 * resolved to a concrete variant — a real ST/C compiler (matiec, STruC++)
 * rejects the bare name as an undefined function.
 *
 * Returns `null` when `blockTypeName` isn't a recognised polymorphic
 * shorthand, or when the supported compiler conversion family does not
 * contain the source/destination pair. Callers should fall back to the
 * original name so an unresolvable case still surfaces the same "undefined
 * function" error it would have before, rather than silently emitting a
 * different wrong name.
 */
export function resolveConversionFunctionName(blockTypeName: string, sourceType: string): string | null {
  const match = blockTypeName.match(/^TO_([A-Z][A-Z0-9]*)$/)
  if (match === null || !TO_CONVERSION_TARGETS.has(match[1])) return null
  const source = sourceType.toUpperCase()
  const destination = match[1]
  if (!isSupportedConversionPair(source, destination)) return null
  return `${source}_TO_${destination}`
}

function isSupportedConversionPair(source: string, destination: string): boolean {
  if (destination === 'BCD') return UNSIGNED_INTEGER_TYPES.has(source)
  if (source === 'BCD') return UNSIGNED_INTEGER_TYPES.has(destination)
  if (destination === 'DATE' && source === 'DATE_AND_TIME') return true
  if (!TO_CONVERSION_TARGETS.has(source) || source === destination) return false
  if (GENERAL_CONVERSION_TARGETS.has(destination)) return true
  if (destination === 'BOOL') return !TEMPORAL_TYPES.has(source)
  return TEMPORAL_TYPES.has(destination) && !TEMPORAL_TYPES.has(source)
}
