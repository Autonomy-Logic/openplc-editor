import type { PLCProjectData } from '@root/middleware/shared/ports/open-plc-types'

/**
 * Collect the signatures of every *library* block a project uses and emit them
 * as a PLCopen `<addData>` payload that the xml2st transpiler reads.
 *
 * Why: xml2st emits a local temporary per FUNCTION output and must declare it
 * with a concrete type. It infers that type from the wired connections, but
 * cannot when a function has no typed pin to borrow from (e.g. a nullary
 * `CURRENT_DT` whose output is unconnected) — it then falls back to the illegal
 * type `ANY`, which STruC++ rejects. Rather than make xml2st carry a block
 * library (which would diverge from the real STruC++ library), we hand it the
 * exact signatures the project uses, embedded in the project file itself.
 *
 * Every graphical block instance already carries its full typed signature in
 * `node.data.variant` (the editor stamps it from the library on placement), so
 * this is a pure function over the project model — no I/O, no library archives,
 * no platform specifics. It therefore lives on the shared surface and is
 * identical across the desktop and web builds.
 *
 * Output shape feeds xmlbuilder2 (see XmlGenerator); it is inserted as
 * `<project>/<addData>` after `<instances>`. Contract: xml2st/docs/library-blocks.md.
 */

const DATA_NAME = 'openplc.org/xml2st/library-blocks'

type XmlElement = Record<string, unknown>

// Minimal view of a block variant's variable; the full schema lives in
// middleware/shared/ports/block-types.ts (blockVariantVariableSchema).
type VariantVariable = {
  name: string
  class: 'input' | 'output' | 'local' | 'inOut'
  type: { definition: 'base-type' | 'generic-type'; value: string }
}

type BlockVariant = {
  name: string
  type: 'function' | 'function-block' | 'generic'
  extensible?: boolean
  variables: VariantVariable[]
}

/** `<INT/>`, `<ANY_NUM/>`, ... — xml2st reads the (upper-cased) tag name. */
const typeElement = (variable: VariantVariable): XmlElement => ({ [variable.type.value]: '' })

const variableElement = (variable: VariantVariable): XmlElement => ({
  '@name': variable.name,
  type: typeElement(variable),
})

/** Walk every graphical POU body and yield each block instance's variant. */
const collectBlockVariants = (project: PLCProjectData): BlockVariant[] => {
  const variants: BlockVariant[] = []

  const visitNodes = (nodes: unknown) => {
    if (!Array.isArray(nodes)) return
    for (const node of nodes) {
      const n = node as { type?: string; data?: { variant?: BlockVariant } }
      if (n?.type === 'block' && n.data?.variant?.name) variants.push(n.data.variant)
    }
  }

  for (const pou of project.pous) {
    const body = pou.data?.body as { language?: string; value?: unknown } | undefined
    if (!body) continue
    if (body.language === 'fbd') {
      const value = body.value as { rung?: { nodes?: unknown } } | undefined
      visitNodes(value?.rung?.nodes)
    } else if (body.language === 'ld') {
      const value = body.value as { rungs?: Array<{ nodes?: unknown }> } | undefined
      for (const rung of value?.rungs ?? []) visitNodes(rung?.nodes)
    }
  }

  return variants
}

const variantToPou = (variant: BlockVariant): XmlElement => {
  const isFunctionBlock = variant.type === 'function-block'
  // EN/ENO are implicit control pins; xml2st adds them itself.
  const vars = variant.variables.filter((v) => v.name !== 'EN' && v.name !== 'ENO')
  const inputs = vars.filter((v) => v.class === 'input')
  const inouts = vars.filter((v) => v.class === 'inOut')
  const outputs = vars.filter((v) => v.class === 'output')

  const iface: XmlElement = {}

  if (!isFunctionBlock) {
    // A function returns a single value; model its primary output (OUT) as the
    // return type, any extra outputs as VAR_OUTPUT.
    const ret = outputs.find((v) => v.name === 'OUT') ?? outputs[0]
    if (ret) iface.returnType = typeElement(ret)
    const extraOutputs = outputs.filter((v) => v !== ret)
    if (extraOutputs.length) iface.outputVars = { variable: extraOutputs.map(variableElement) }
  } else if (outputs.length) {
    iface.outputVars = { variable: outputs.map(variableElement) }
  }

  if (inputs.length) iface.inputVars = { variable: inputs.map(variableElement) }
  if (inouts.length) iface.inOutVars = { variable: inouts.map(variableElement) }

  return {
    '@name': variant.name,
    '@pouType': isFunctionBlock ? 'functionBlock' : 'function',
    ...(variant.extensible ? { '@extensible': true } : {}),
    interface: iface,
  }
}

/**
 * Build the `<addData>` library-blocks payload for a project, or `null` when the
 * project references no library blocks (e.g. text-only POUs).
 *
 * User-defined POUs are excluded: their definitions already travel in
 * `<types><pous>` and xml2st resolves them directly.
 */
export const collectLibraryBlocks = (project: PLCProjectData): XmlElement | null => {
  const userPouNames = new Set(project.pous.map((pou) => pou.data?.name))

  const byName = new Map<string, BlockVariant>()
  for (const variant of collectBlockVariants(project)) {
    if (userPouNames.has(variant.name)) continue
    if (!byName.has(variant.name)) byName.set(variant.name, variant)
  }
  if (byName.size === 0) return null

  const pous = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)).map(variantToPou)

  return {
    data: {
      '@name': DATA_NAME,
      '@handleUnknown': 'discard',
      libraryBlocks: { pou: pous },
    },
  }
}
