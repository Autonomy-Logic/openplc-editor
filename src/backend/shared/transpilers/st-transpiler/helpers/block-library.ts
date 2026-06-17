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

function isRecord(v: unknown): v is Record<string, unknown> {
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
    type: variant.type === 'function-block' ? 'functionBlock' : 'function',
    extensible: variant.extensible === true,
    inputs,
    outputs,
    comment: '',
    usage: '',
  }
}
