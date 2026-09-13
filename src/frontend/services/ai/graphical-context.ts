// The transpiler is injected: reached via a Web Worker in the browser, IPC on desktop.

import type { PLCProjectData } from '../../../middleware/shared/ports/types'
import type { FBDFlowType } from '../../store/slices/fbd/types'
import type { LadderFlowType, RungLadderState } from '../../store/slices/ladder/types'

let cachedProgramSt: string | null = null
let cacheTimestamp = 0
// Immer replaces both arrays on any edit, so their identity says which project the ST describes.
let cachedPous: PLCProjectData['pous'] | null = null
let cachedDataTypes: PLCProjectData['dataTypes'] | null = null
const CACHE_TTL_MS = 30_000

function isCachedFor(projectData: PLCProjectData): boolean {
  return cachedPous === projectData.pous && cachedDataTypes === projectData.dataTypes
}

/** Transpiles the whole project to ST; must return null, not '', when it cannot produce ST. */
export type ProjectStTranspiler = (projectData: PLCProjectData) => Promise<string | null>

/** Transpiles the project to ST, caching per `pous`/`dataTypes` identity; without a transpiler, returns the stale cache. */
export async function transpileProjectToST(
  projectData: PLCProjectData,
  transpile?: ProjectStTranspiler,
): Promise<string | null> {
  if (!isCachedFor(projectData)) invalidateSTCache()

  const now = Date.now()
  if (cachedProgramSt && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedProgramSt
  }
  if (!transpile) return cachedProgramSt

  try {
    const programSt = await transpile(projectData)
    if (programSt) {
      cachedProgramSt = programSt
      cacheTimestamp = now
      cachedPous = projectData.pous
      cachedDataTypes = projectData.dataTypes
      return cachedProgramSt
    }
    return cachedProgramSt
  } catch (error) {
    console.warn('[AI Graphical] project transpile error:', error)
    return cachedProgramSt
  }
}

/** Clears the ST cache; call when the diagram is edited so a failed transpile never falls back to it. */
export function invalidateSTCache(): void {
  cachedProgramSt = null
  cacheTimestamp = 0
  cachedPous = null
  cachedDataTypes = null
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Extracts a single POU's ST from the full program_st output. */
export function extractPouST(programSt: string, pouName: string, pouType: string): string {
  const keyword = pouType === 'function-block' ? 'FUNCTION_BLOCK' : pouType === 'function' ? 'FUNCTION' : 'PROGRAM'
  const endKeyword = `END_${keyword}`

  const pattern = new RegExp(`(^${keyword}\\s+${escapeRegExp(pouName)}\\b.*?^${endKeyword})`, 'ms')

  const match = programSt.match(pattern)
  return match ? match[1].trim() : ''
}

/** Generates layout metadata for a Ladder Diagram from its XYFlow state. */
export function generateLadderLayoutMetadata(ladderFlow: LadderFlowType): string {
  if (!ladderFlow.rungs.length) return '(* Empty ladder diagram *)'

  const rungDescriptions = ladderFlow.rungs.map((rung, index) => describeRung(rung, index + 1))

  return `(* === Diagram Layout Metadata === *)\n${rungDescriptions.join('\n')}`
}

type NodeData = Record<string, unknown>

function getNodeField<T>(node: { data: NodeData }, field: string): T | undefined {
  return (node.data as Record<string, unknown>)[field] as T | undefined
}

function describeRung(rung: RungLadderState, rungNumber: number): string {
  const nodes = rung.nodes

  const contacts = nodes.filter((n) => n.type === 'contact')
  const coils = nodes.filter((n) => n.type === 'coil')
  const blocks = nodes.filter((n) => n.type === 'block')
  const hasParallel = nodes.some((n) => n.type === 'parallel')

  const elements: string[] = []

  const sortedContacts = [...contacts].sort((a, b) => a.position.x - b.position.x)
  for (const contact of sortedContacts) {
    const varName = getNodeField<{ name: string }>(contact, 'variable')?.name ?? '???'
    const variant = getNodeField<string>(contact, 'variant') ?? 'default'
    elements.push(`   - Contact "${varName}" (${variant})`)
  }

  const sortedBlocks = [...blocks].sort((a, b) => a.position.x - b.position.x)
  for (const block of sortedBlocks) {
    const blockType = getNodeField<{ name: string }>(block, 'variant')?.name ?? 'Unknown'
    const instanceName = getNodeField<{ name: string }>(block, 'variable')?.name ?? ''
    elements.push(`   - Block "${blockType}" instance "${instanceName}"`)
  }

  const sortedCoils = [...coils].sort((a, b) => a.position.x - b.position.x)
  for (const coil of sortedCoils) {
    const varName = getNodeField<{ name: string }>(coil, 'variable')?.name ?? '???'
    const variant = getNodeField<string>(coil, 'variant') ?? 'default'
    elements.push(`   - Coil "${varName}" (${variant})`)
  }

  const elementCount = contacts.length + coils.length + blocks.length
  const comment = rung.comment ? ` — ${rung.comment}` : ''
  const parallelNote = hasParallel ? ' [has parallel branches]' : ''

  return `(* Rung ${rungNumber} [id=${rung.id}]: ${elementCount} elements${comment}${parallelNote}\n${elements.join('\n')} *)`
}

/** Generates layout metadata for a Function Block Diagram from its XYFlow state. */
export function generateFBDLayoutMetadata(fbdFlow: FBDFlowType): string {
  const { nodes, edges } = fbdFlow.rung
  if (!nodes.length) return '(* Empty FBD diagram *)'

  const blockNodes = nodes.filter((n) => n.type === 'block')
  const inputVars = nodes.filter((n) => n.type === 'input-variable')
  const outputVars = nodes.filter((n) => n.type === 'output-variable')

  const sortedBlocks = [...blockNodes].sort(
    (a, b) => (getNodeField<number>(a, 'executionOrder') ?? 0) - (getNodeField<number>(b, 'executionOrder') ?? 0),
  )

  const elements: string[] = []

  for (const iv of inputVars) {
    const varName = getNodeField<{ name: string }>(iv, 'variable')?.name ?? '???'
    elements.push(`   - Input variable: "${varName}"`)
  }

  for (const block of sortedBlocks) {
    const blockType = getNodeField<{ name: string }>(block, 'variant')?.name ?? 'Unknown'
    const instanceName = getNodeField<{ name: string }>(block, 'variable')?.name ?? ''
    const execOrder = getNodeField<number>(block, 'executionOrder') ?? 0

    const inputEdges = edges.filter((e) => e.target === block.id)
    const inputSources = inputEdges.map((e) => {
      const src = nodes.find((n) => n.id === e.source)
      if (!src) return '?'
      return (
        getNodeField<{ name: string }>(src, 'variable')?.name ??
        getNodeField<{ name: string }>(src, 'variant')?.name ??
        src.type ??
        '?'
      )
    })

    const inputsStr = inputSources.length > 0 ? ` <- [${inputSources.join(', ')}]` : ''
    elements.push(`   - Block "${blockType}" instance "${instanceName}" (exec #${execOrder})${inputsStr}`)
  }

  for (const ov of outputVars) {
    const varName = getNodeField<{ name: string }>(ov, 'variable')?.name ?? '???'
    const inputEdge = edges.find((e) => e.target === ov.id)
    const sourceNode = inputEdge ? nodes.find((n) => n.id === inputEdge.source) : null
    const sourceDesc = sourceNode
      ? (getNodeField<{ name: string }>(sourceNode, 'variant')?.name ?? sourceNode.type ?? '?')
      : '?'
    elements.push(`   - Output variable: "${varName}" <- ${sourceDesc}`)
  }

  return (
    `(* === Diagram Layout Metadata === *)\n` +
    `(* FBD: ${blockNodes.length} blocks, ${inputVars.length} inputs, ${outputVars.length} outputs\n` +
    `${elements.join('\n')} *)`
  )
}

/** Builds the full graphical context string for AI chat. */
export function generateGraphicalContext(
  pouName: string,
  pouType: string,
  pouLang: string,
  stCode: string | null,
  layoutMetadata: string,
  projectContext: string,
): string {
  const langLabel = pouLang === 'ld' ? 'Ladder Diagram' : 'Function Block Diagram'
  const parts: string[] = []

  parts.push(`(* Current POU: ${pouName} [${pouType}] language=${pouLang} *)`)

  if (stCode) {
    parts.push(`(* === Equivalent Structured Text (transpiled from ${langLabel}) === *)\n${stCode}`)
  } else {
    parts.push(`(* ST transpilation unavailable — using layout metadata only *)`)
  }

  parts.push(layoutMetadata)

  if (projectContext) {
    parts.push(projectContext)
  }

  return parts.join('\n\n')
}
