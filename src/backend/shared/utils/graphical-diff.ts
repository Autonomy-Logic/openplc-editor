/**
 * Graphical diff utilities — pure data transformation for LD/FBD flow comparison.
 *
 * Parses IEC 61131-3 source files containing embedded JSON flow data,
 * extracts variable declarations, and computes semantic diffs between two versions.
 *
 * This module is backend-only. Frontend accesses it through VersionControlPort.
 */

import type { Edge, Node } from '@xyflow/react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DiffStatus = 'added' | 'removed' | 'modified' | 'unchanged'

export type FlowData = {
  /** Rung id as serialized in the POU body. Present for LD, absent for FBD (single rung). */
  id?: string
  nodes: Node[]
  edges: Edge[]
  /** Saved viewport dimensions `[width, height]` — matches the ladder editor default `[1530, 200]`. */
  reactFlowViewport?: [number, number]
}

type RungPair = { original: FlowData | null; current: FlowData | null }

export type ParsedVariable = {
  name: string
  type: string
  class: string
  location?: string
  initialValue?: string
}

export type VarDiffEntry = {
  name: string
  status: DiffStatus
  original?: ParsedVariable
  current?: ParsedVariable
}

export type GraphicalDiffResult = {
  flows: {
    original: FlowData | null
    current: FlowData | null
    /** Per-side dimensions — each RungCell uses its own so the smaller side doesn't inherit empty space from the larger one. */
    originalHeight: number
    currentHeight: number
    originalWidth: number
    currentWidth: number
  }[]
  changedIndexes: number[]
  variableDiff: VarDiffEntry[]
  nodeDiffMaps: { original: Map<string, DiffStatus>; current: Map<string, DiffStatus> }
  edgeDiffMaps: { original: Map<string, DiffStatus>; current: Map<string, DiffStatus> }[]
  isLadder: boolean
}

// Node types that should never show diff highlighting (structural/auxiliary)
const STRUCTURAL_NODE_TYPES = new Set([
  'powerRail',
  'parallel',
  'placeholder',
  'parallelPlaceholder',
  'mockNode',
  'variable',
])

// ---------------------------------------------------------------------------
// Flow data extraction
// ---------------------------------------------------------------------------

function extractFlowData(content: string, ext: 'ld' | 'fbd'): FlowData[] | null {
  const endMatch = content.match(/\b(END_PROGRAM|END_FUNCTION_BLOCK|END_FUNCTION)\b/i)
  if (!endMatch || endMatch.index === undefined) return null

  const beforeEnd = content.slice(0, endMatch.index)
  const endVarIdx = beforeEnd.lastIndexOf('END_VAR')
  if (endVarIdx === -1) return null

  const bodyContent = beforeEnd.slice(endVarIdx + 'END_VAR'.length).trim()
  try {
    let parsed: unknown = JSON.parse(bodyContent) as unknown
    if (typeof parsed === 'string') parsed = JSON.parse(parsed) as unknown

    type RawFlow = {
      id?: string
      nodes?: Node[]
      edges?: Edge[]
      reactFlowViewport?: [number, number]
    }

    if (ext === 'ld') {
      const rungs = (parsed as { rungs?: RawFlow[] }).rungs
      if (!Array.isArray(rungs)) return null
      return rungs.map((r) => ({
        id: r.id,
        nodes: r.nodes ?? [],
        edges: r.edges ?? [],
        reactFlowViewport: r.reactFlowViewport,
      }))
    } else {
      const rung = (parsed as { rung?: RawFlow }).rung
      if (!rung) return null
      return [{ nodes: rung.nodes ?? [], edges: rung.edges ?? [], reactFlowViewport: rung.reactFlowViewport }]
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Variable parsing
// ---------------------------------------------------------------------------

function extractVariables(content: string): ParsedVariable[] {
  const variables: ParsedVariable[] = []
  const varBlockRegex = /(VAR(?:_INPUT|_OUTPUT|_IN_OUT|_EXTERNAL|_GLOBAL|_TEMP)?)\s*\n([\s\S]*?)END_VAR/g
  let match: RegExpExecArray | null
  while ((match = varBlockRegex.exec(content)) !== null) {
    const varClass = match[1]
    const blockBody = match[2]
    const lineRegex = /^\s*(\w+)\s*:\s*(\S+)(?:\s+AT\s+(\S+))?(?:\s*:=\s*([^;]+))?\s*;/gm
    let lineMatch: RegExpExecArray | null
    while ((lineMatch = lineRegex.exec(blockBody)) !== null) {
      variables.push({
        name: lineMatch[1],
        type: lineMatch[2],
        class: varClass,
        location: lineMatch[3] || undefined,
        initialValue: lineMatch[4]?.trim() || undefined,
      })
    }
  }
  return variables
}

// ---------------------------------------------------------------------------
// Variable diffing
// ---------------------------------------------------------------------------

function computeVariableDiff(originalContent: string, currentContent: string): VarDiffEntry[] {
  const origVars = extractVariables(originalContent)
  const currVars = extractVariables(currentContent)

  const origByName = new Map(origVars.map((v) => [v.name, v]))
  const currByName = new Map(currVars.map((v) => [v.name, v]))

  const entries: VarDiffEntry[] = []
  const seen = new Set<string>()

  for (const [name, curr] of currByName) {
    seen.add(name)
    const orig = origByName.get(name)
    if (!orig) {
      entries.push({ name, status: 'added', current: curr })
    } else {
      const changed =
        orig.type !== curr.type ||
        orig.class !== curr.class ||
        orig.location !== curr.location ||
        orig.initialValue !== curr.initialValue
      if (changed) {
        entries.push({ name, status: 'modified', original: orig, current: curr })
      }
    }
  }

  for (const [name, orig] of origByName) {
    if (!seen.has(name)) {
      entries.push({ name, status: 'removed', original: orig })
    }
  }

  return entries
}

// ---------------------------------------------------------------------------
// Rung alignment
// ---------------------------------------------------------------------------

function pairRungsByIndex(original: FlowData[], current: FlowData[]): RungPair[] {
  const pairs: RungPair[] = []
  for (let i = 0; i < Math.max(original.length, current.length); i++) {
    pairs.push({ original: original[i] ?? null, current: current[i] ?? null })
  }
  return pairs
}

function hasUniqueIds(flows: FlowData[]): boolean {
  const ids = flows.map((f) => f.id).filter((id): id is string => !!id)
  return ids.length === flows.length && new Set(ids).size === ids.length
}

// The LCS table below is quadratic and allocated on the main thread, once per
// changed file. Past this, positional pairing is good enough.
const MAX_ALIGNABLE_RUNGS = 1000

/**
 * Aligns rungs by their serialized id via LCS, so inserting or deleting a rung
 * doesn't shift every rung below it against the wrong counterpart. Falls back to
 * positional pairing when the ids can't be trusted.
 */
function alignRungs(originalFlows: FlowData[] | null, currentFlows: FlowData[] | null): RungPair[] {
  const original = originalFlows ?? []
  const current = currentFlows ?? []
  if (original.length === 0 || current.length === 0) return pairRungsByIndex(original, current)
  if (!hasUniqueIds(original) || !hasUniqueIds(current)) return pairRungsByIndex(original, current)

  const m = original.length
  const n = current.length
  if (m > MAX_ALIGNABLE_RUNGS || n > MAX_ALIGNABLE_RUNGS) return pairRungsByIndex(original, current)

  // lcs[i][j] = length of the longest common id subsequence of original[i..] and current[j..]
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] = original[i].id === current[j].id ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  // Ids intersect nowhere: they were regenerated wholesale, so they aren't identity.
  if (lcs[0][0] === 0) return pairRungsByIndex(original, current)

  const pairs: RungPair[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (original[i].id === current[j].id) {
      pairs.push({ original: original[i], current: current[j] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      pairs.push({ original: original[i], current: null })
      i++
    } else {
      pairs.push({ original: null, current: current[j] })
      j++
    }
  }
  while (i < m) pairs.push({ original: original[i++], current: null })
  while (j < n) pairs.push({ original: null, current: current[j++] })
  return pairs
}

// ---------------------------------------------------------------------------
// Semantic node matching
// ---------------------------------------------------------------------------

function getSemanticKey(node: Node): string {
  const type = node.type ?? ''
  const varName = (node.data?.variable as { name?: string })?.name ?? ''
  const variantName = (node.data?.variant as { name?: string })?.name ?? ''
  return `${type}|${varName || variantName}`
}

function getContentFingerprint(node: Node, includePosition = true): string {
  const varName = (node.data?.variable as { name?: string })?.name ?? ''
  const variantName = (node.data?.variant as { name?: string })?.name ?? ''
  const variantType = (node.data?.variant as { type?: string })?.type ?? ''
  const variantVars = (node.data?.variant as { variables?: Array<{ name: string; class: string }> })?.variables
  const varsKey = variantVars
    ? variantVars
        .map((v) => `${v.name}:${v.class}`)
        .sort()
        .join(',')
    : ''
  const pos = includePosition ? `${node.position?.x ?? 0},${node.position?.y ?? 0}` : ''
  return `${node.type}|${varName}|${variantName}|${variantType}|${varsKey}|${pos}`
}

function getPositionKey(node: Node): string {
  return `${node.type ?? ''}@${node.position?.x ?? 0},${node.position?.y ?? 0}`
}

/**
 * Rung-local matchers, strongest first. Node ids survive serialization and a
 * rebind; the weaker keys recover matches when an XML round trip renumbered them.
 */
const RUNG_NODE_MATCHERS: Array<(node: Node) => string> = [(node) => node.id, getSemanticKey, getPositionKey]

function matchNodePools(
  originalPool: Node[],
  currentPool: Node[],
  keyOf: (node: Node) => string,
  onMatch: (currentNode: Node, originalNode: Node) => void,
): { original: Node[]; current: Node[] } {
  const candidates = new Map<string, Node[]>()
  for (const node of originalPool) {
    const key = keyOf(node)
    const arr = candidates.get(key) ?? []
    arr.push(node)
    candidates.set(key, arr)
  }

  const matchedOrigIds = new Set<string>()
  const unmatchedCurrent: Node[] = []

  for (const node of currentPool) {
    const match = candidates.get(keyOf(node))?.find((c) => !matchedOrigIds.has(c.id))
    if (!match) {
      unmatchedCurrent.push(node)
      continue
    }
    matchedOrigIds.add(match.id)
    onMatch(node, match)
  }

  return { original: originalPool.filter((n) => !matchedOrigIds.has(n.id)), current: unmatchedCurrent }
}

/**
 * Matching is scoped to paired rungs: a global pass lets an element consume the
 * counterpart of an element in another rung whenever they share a semantic key
 * (two unbound contacts, say), painting untouched rungs as modified/removed —
 * DOPE-496. The one cross-rung pass left is a safety net for when rung alignment
 * itself failed, not move detection: elements can't change rungs.
 */
function computeNodeDiffMap(rungPairs: RungPair[]): {
  original: Map<string, DiffStatus>
  current: Map<string, DiffStatus>
} {
  const original = new Map<string, DiffStatus>()
  const current = new Map<string, DiffStatus>()

  const settle = (currentNode: Node, originalNode: Node, includePosition: boolean) => {
    const changed =
      getContentFingerprint(currentNode, includePosition) !== getContentFingerprint(originalNode, includePosition)
    current.set(currentNode.id, changed ? 'modified' : 'unchanged')
    original.set(originalNode.id, changed ? 'modified' : 'unchanged')
  }

  const isStructural = (node: Node) => STRUCTURAL_NODE_TYPES.has(node.type ?? '')
  const leftoverOriginal: Node[] = []
  const leftoverCurrent: Node[] = []

  for (const pair of rungPairs) {
    for (const node of pair.original?.nodes ?? []) if (isStructural(node)) original.set(node.id, 'unchanged')
    for (const node of pair.current?.nodes ?? []) if (isStructural(node)) current.set(node.id, 'unchanged')

    let pendingOriginal = (pair.original?.nodes ?? []).filter((n) => !isStructural(n))
    let pendingCurrent = (pair.current?.nodes ?? []).filter((n) => !isStructural(n))

    for (const keyOf of RUNG_NODE_MATCHERS) {
      if (pendingOriginal.length === 0 || pendingCurrent.length === 0) break
      const rest = matchNodePools(pendingOriginal, pendingCurrent, keyOf, (currentNode, originalNode) =>
        settle(currentNode, originalNode, true),
      )
      pendingOriginal = rest.original
      pendingCurrent = rest.current
    }

    leftoverOriginal.push(...pendingOriginal)
    leftoverCurrent.push(...pendingCurrent)
  }

  // Position is excluded: reaching here means the rung pair was wrong, so these
  // rung-local coordinates were measured against a rung the node never sat in.
  const strandedByOriginalId = new Map(leftoverOriginal.map((node) => [node.id, node]))
  for (const node of leftoverCurrent) {
    const match = strandedByOriginalId.get(node.id)
    if (!match) {
      current.set(node.id, 'added')
      continue
    }
    strandedByOriginalId.delete(node.id)
    settle(node, match, false)
  }

  for (const node of leftoverOriginal) {
    if (!original.has(node.id)) original.set(node.id, 'removed')
  }

  return { original, current }
}

// ---------------------------------------------------------------------------
// Semantic edge matching
// ---------------------------------------------------------------------------

function getEdgeSemanticKey(edge: Edge, nodeKeyMap: Map<string, string>): string {
  const srcKey = nodeKeyMap.get(edge.source) ?? edge.source
  const tgtKey = nodeKeyMap.get(edge.target) ?? edge.target
  return `${srcKey}::${edge.sourceHandle ?? ''}-->${tgtKey}::${edge.targetHandle ?? ''}`
}

function computeEdgeDiffMaps(
  originalFlow: FlowData | null,
  currentFlow: FlowData | null,
  originalNodeDiffMap: Map<string, DiffStatus>,
  currentNodeDiffMap: Map<string, DiffStatus>,
): { original: Map<string, DiffStatus>; current: Map<string, DiffStatus> } {
  const original = new Map<string, DiffStatus>()
  const current = new Map<string, DiffStatus>()

  if (!originalFlow && !currentFlow) return { original, current }

  const origNodeKeyMap = new Map<string, string>()
  const currNodeKeyMap = new Map<string, string>()

  if (originalFlow) {
    for (const node of originalFlow.nodes) origNodeKeyMap.set(node.id, getSemanticKey(node))
  }
  if (currentFlow) {
    for (const node of currentFlow.nodes) currNodeKeyMap.set(node.id, getSemanticKey(node))
  }

  const origEdgeKeys = new Set<string>()
  if (originalFlow) {
    for (const edge of originalFlow.edges) origEdgeKeys.add(getEdgeSemanticKey(edge, origNodeKeyMap))
  }

  const currEdgeKeys = new Set<string>()
  if (currentFlow) {
    for (const edge of currentFlow.edges) {
      const key = getEdgeSemanticKey(edge, currNodeKeyMap)
      currEdgeKeys.add(key)
      if (!origEdgeKeys.has(key)) {
        current.set(edge.id, 'added')
      } else {
        const srcModified = currentNodeDiffMap.get(edge.source) === 'modified'
        const tgtModified = currentNodeDiffMap.get(edge.target) === 'modified'
        current.set(edge.id, srcModified || tgtModified ? 'modified' : 'unchanged')
      }
    }
  }

  if (originalFlow) {
    for (const edge of originalFlow.edges) {
      const key = getEdgeSemanticKey(edge, origNodeKeyMap)
      if (!currEdgeKeys.has(key)) {
        original.set(edge.id, 'removed')
      } else {
        const srcModified = originalNodeDiffMap.get(edge.source) === 'modified'
        const tgtModified = originalNodeDiffMap.get(edge.target) === 'modified'
        original.set(edge.id, srcModified || tgtModified ? 'modified' : 'unchanged')
      }
    }
  }

  return { original, current }
}

// ---------------------------------------------------------------------------
// Rung height computation
// ---------------------------------------------------------------------------

function calcRungHeight(nodes: Node[]): number {
  if (nodes.length === 0) return 80
  let minY = Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    const ny = node.position?.y ?? 0
    const nh = (node.measured?.height as number) ?? (node.height as number) ?? 40
    if (ny < minY) minY = ny
    if (ny + nh > maxY) maxY = ny + nh
  }
  return Math.max(maxY - minY + 80, 120)
}

function calcRungWidth(nodes: Node[]): number {
  if (nodes.length === 0) return 400
  let maxX = 0
  for (const node of nodes) {
    const nx = node.position?.x ?? 0
    const nw = (node.measured?.width as number) ?? (node.width as number) ?? 100
    if (nx + nw > maxX) maxX = nx + nw
  }
  return maxX + 40
}

// ---------------------------------------------------------------------------
// Public API: compute full graphical diff
// ---------------------------------------------------------------------------

export function computeGraphicalDiff(
  originalContent: string,
  currentContent: string,
  filePath: string,
): GraphicalDiffResult {
  const ext = filePath.split('.').pop()?.toLowerCase() as 'ld' | 'fbd'
  const isLadder = ext === 'ld'

  const originalFlows = extractFlowData(originalContent, ext)
  const currentFlows = extractFlowData(currentContent, ext)

  const variableDiff = computeVariableDiff(originalContent, currentContent)
  const rungPairs = alignRungs(originalFlows, currentFlows)
  const nodeDiffMaps = computeNodeDiffMap(rungPairs)

  const flows: GraphicalDiffResult['flows'] = []
  const changedIndexes: number[] = []
  const edgeDiffMaps: GraphicalDiffResult['edgeDiffMaps'] = []

  for (let i = 0; i < rungPairs.length; i++) {
    const orig = rungPairs[i].original
    const curr = rungPairs[i].current

    // Per-side dimensions (content bounds). Each side uses its own so the
    // smaller side doesn't get padded to match the larger one.
    const originalHeight = orig ? calcRungHeight(orig.nodes) : 80
    const currentHeight = curr ? calcRungHeight(curr.nodes) : 80
    const originalWidth = orig ? calcRungWidth(orig.nodes) : isLadder ? 0 : 400
    const currentWidth = curr ? calcRungWidth(curr.nodes) : isLadder ? 0 : 400

    flows.push({ original: orig, current: curr, originalHeight, currentHeight, originalWidth, currentWidth })

    const rungEdgeDiff = computeEdgeDiffMaps(orig, curr, nodeDiffMaps.original, nodeDiffMaps.current)
    edgeDiffMaps.push(rungEdgeDiff)

    // Detect change from the semantic diff maps rather than raw JSON
    // byte-comparison. A byte-level compare would flag rungs as changed on
    // any non-semantic drift (stripped/reordered transient fields from
    // the sync-back cycle, ReactFlow-injected runtime state, etc.) even
    // when the ladder is visually identical.
    const nodeChanged =
      (curr?.nodes ?? []).some((n) => (nodeDiffMaps.current.get(n.id) ?? 'unchanged') !== 'unchanged') ||
      (orig?.nodes ?? []).some((n) => (nodeDiffMaps.original.get(n.id) ?? 'unchanged') !== 'unchanged')
    const edgeChanged =
      (curr?.edges ?? []).some((e) => (rungEdgeDiff.current.get(e.id) ?? 'unchanged') !== 'unchanged') ||
      (orig?.edges ?? []).some((e) => (rungEdgeDiff.original.get(e.id) ?? 'unchanged') !== 'unchanged')
    if (!orig || !curr || nodeChanged || edgeChanged) {
      changedIndexes.push(i)
    }
  }

  return {
    flows,
    changedIndexes,
    variableDiff,
    nodeDiffMaps,
    edgeDiffMaps,
    isLadder,
  }
}
