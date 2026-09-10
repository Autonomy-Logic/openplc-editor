/**
 * Graphical Context Generation for AI Chat
 *
 * Provides AI context for Ladder Diagram (LD) and Function Block Diagram (FBD) editors
 * by transpiling graphical programs to ST and generating layout
 * metadata from the live XYFlow state.
 *
 * The transpile itself is NOT here. It is the same JSON transpiler on both
 * builds, but it is reached differently — a dedicated Web Worker in the browser,
 * the main process over IPC on the desktop — so the caller supplies it and this
 * module only owns the caching and the formatting around it.
 */

import type { PLCProjectData } from '../../../middleware/shared/ports/types'
import type { FBDFlowType } from '../../store/slices/fbd/types'
import type { LadderFlowType, RungLadderState } from '../../store/slices/ladder/types'

// ---------------------------------------------------------------------------
// ST Transpilation via the in-process JSON transpiler (with caching)
// ---------------------------------------------------------------------------

let cachedProgramSt: string | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 30_000 // 30 seconds

/**
 * Turn a whole project into ST, the way the compile and library paths do.
 *
 * Supplied by the platform because the transpiler runs on a Web Worker in the
 * browser and in the main process on the desktop. It must never throw and must
 * answer `null` — not an empty string — when it cannot produce ST, so a caller
 * can tell "transpile unavailable" from "this POU really is empty".
 */
export type ProjectStTranspiler = (projectData: PLCProjectData) => Promise<string | null>

/**
 * Transpile the full project to ST. Results cache for CACHE_TTL_MS to
 * avoid repeat work during a chat session.  Returns null if both the
 * call and any stale cache fail. Runs the same transpiler the
 * compile/library paths use, so AI context stays consistent with
 * what the pipeline emits.
 *
 * A missing `transpile` is not an error: it means this build has not wired one
 * up yet, and the answer is the stale cache (usually null), which every caller
 * already handles as "no ST for this diagram".
 */
export async function transpileProjectToST(
  projectData: PLCProjectData,
  transpile?: ProjectStTranspiler,
): Promise<string | null> {
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
      return cachedProgramSt
    }
    return cachedProgramSt
  } catch (error) {
    console.warn('[AI Graphical] project transpile error:', error)
    return cachedProgramSt
  }
}

/**
 * Forget the cached ST (call when the diagram is edited).
 *
 * Drops the text as well as the timestamp: after an edit the cached program is
 * not merely stale, it describes a diagram that no longer exists, and serving it
 * as the fallback for a failed transpile would answer a question about the old
 * project.
 */
export function invalidateSTCache(): void {
  cachedProgramSt = null
  cacheTimestamp = 0
}

// ---------------------------------------------------------------------------
// POU ST Extraction
// ---------------------------------------------------------------------------

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Extract a single POU's ST code from the full program_st output.
 * Matches PROGRAM...END_PROGRAM, FUNCTION_BLOCK...END_FUNCTION_BLOCK, or FUNCTION...END_FUNCTION.
 */
export function extractPouST(programSt: string, pouName: string, pouType: string): string {
  const keyword = pouType === 'function-block' ? 'FUNCTION_BLOCK' : pouType === 'function' ? 'FUNCTION' : 'PROGRAM'
  const endKeyword = `END_${keyword}`

  // Multiline + dotAll: match from the keyword line to its corresponding END keyword at line start
  const pattern = new RegExp(`(^${keyword}\\s+${escapeRegExp(pouName)}\\b.*?^${endKeyword})`, 'ms')

  const match = programSt.match(pattern)
  return match ? match[1].trim() : ''
}

// ---------------------------------------------------------------------------
// Ladder Diagram Layout Metadata
// ---------------------------------------------------------------------------

/**
 * Generate layout metadata for a Ladder Diagram from its XYFlow state.
 * Describes each rung's elements (contacts, coils, blocks) with their
 * variable names, variants, and whether parallel branches exist.
 */
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

  // Contacts sorted left-to-right
  const sortedContacts = [...contacts].sort((a, b) => a.position.x - b.position.x)
  for (const contact of sortedContacts) {
    const varName = getNodeField<{ name: string }>(contact, 'variable')?.name ?? '???'
    const variant = getNodeField<string>(contact, 'variant') ?? 'default'
    elements.push(`   - Contact "${varName}" (${variant})`)
  }

  // Blocks sorted left-to-right
  const sortedBlocks = [...blocks].sort((a, b) => a.position.x - b.position.x)
  for (const block of sortedBlocks) {
    const blockType = getNodeField<{ name: string }>(block, 'variant')?.name ?? 'Unknown'
    const instanceName = getNodeField<{ name: string }>(block, 'variable')?.name ?? ''
    elements.push(`   - Block "${blockType}" instance "${instanceName}"`)
  }

  // Coils sorted left-to-right
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

// ---------------------------------------------------------------------------
// FBD Layout Metadata
// ---------------------------------------------------------------------------

/**
 * Generate layout metadata for a Function Block Diagram from its XYFlow state.
 * Lists blocks in execution order with their connections, plus input/output variables.
 */
export function generateFBDLayoutMetadata(fbdFlow: FBDFlowType): string {
  const { nodes, edges } = fbdFlow.rung
  if (!nodes.length) return '(* Empty FBD diagram *)'

  const blockNodes = nodes.filter((n) => n.type === 'block')
  const inputVars = nodes.filter((n) => n.type === 'input-variable')
  const outputVars = nodes.filter((n) => n.type === 'output-variable')

  // Sort blocks by execution order
  const sortedBlocks = [...blockNodes].sort(
    (a, b) => (getNodeField<number>(a, 'executionOrder') ?? 0) - (getNodeField<number>(b, 'executionOrder') ?? 0),
  )

  const elements: string[] = []

  // Input variables
  for (const iv of inputVars) {
    const varName = getNodeField<{ name: string }>(iv, 'variable')?.name ?? '???'
    elements.push(`   - Input variable: "${varName}"`)
  }

  // Blocks in execution order
  for (const block of sortedBlocks) {
    const blockType = getNodeField<{ name: string }>(block, 'variant')?.name ?? 'Unknown'
    const instanceName = getNodeField<{ name: string }>(block, 'variable')?.name ?? ''
    const execOrder = getNodeField<number>(block, 'executionOrder') ?? 0

    // Find inputs feeding this block
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

  // Output variables
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

// ---------------------------------------------------------------------------
// Main Context Assembler
// ---------------------------------------------------------------------------

/**
 * Build the full graphical context string for AI chat.
 * Combines: POU identity + transpiled ST + layout metadata + project context.
 */
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
