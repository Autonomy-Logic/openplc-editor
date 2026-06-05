import { PLCProjectData } from '../../types/PLC/open-plc'

/**
 * An FBD variable block (input or output) whose name is blank.
 *
 * Such a block serialises to an empty `<expression/>` in the PLCopen
 * XML, which makes xml2st abort the whole compile with the opaque
 * `'NoneType' object has no attribute 'split'` error.  We catch it
 * before XML generation and report it in terms the user can act on:
 * what the block is wired to, falling back to its canvas position when
 * it is wired to nothing.
 */
export type EmptyFbdVariable = {
  pouName: string
  kind: 'input' | 'output'
  /** Human description of the wired neighbour, or `null` when unconnected. */
  connectedTo: string | null
  x: number
  y: number
}

/** The `input-variable` / `output-variable` FBD node kinds we check. */
const VARIABLE_NODE_KINDS: Record<string, EmptyFbdVariable['kind']> = {
  'input-variable': 'input',
  'output-variable': 'output',
}

/**
 * The slices of an FBD node we read.  The flow schema types `node.data`
 * as `any` (it is platform UI state), so we narrow to the two fields
 * used to label a node: a variable/instance `name` and a block's
 * `variant.name` (its type).
 */
type FbdNodeData = { variable?: { name?: string }; variant?: { name?: string } }

/** Structural shape of the FBD rung we traverse (subset of the flow schema). */
type FbdRung = {
  nodes: ReadonlyArray<{ id: string; type: string; data?: unknown }>
  edges: ReadonlyArray<{ source: string; sourceHandle: string; target: string; targetHandle: string }>
}

/** Best user-facing label for a node: its instance/variable name, else its block type. */
function nodeLabel(data: unknown): string | undefined {
  const { variable, variant } = (data ?? {}) as FbdNodeData
  return variable?.name?.trim() || variant?.name?.trim() || undefined
}

/**
 * Describe what an FBD variable block is wired to, e.g. `"blink_out" of
 * "BLINK_PY0"` or `"T#1s"`.  Output variables are fed by an incoming
 * edge; input variables drive an outgoing one.  Returns `null` when the
 * block is unconnected or the neighbour cannot be labelled.
 */
function describeConnection(nodeId: string, kind: EmptyFbdVariable['kind'], rung: FbdRung): string | null {
  const edge =
    kind === 'output' ? rung.edges.find((e) => e.target === nodeId) : rung.edges.find((e) => e.source === nodeId)
  if (edge === undefined) return null

  const neighbourId = kind === 'output' ? edge.source : edge.target
  const handle = kind === 'output' ? edge.sourceHandle : edge.targetHandle
  const neighbour = rung.nodes.find((n) => n.id === neighbourId)
  if (neighbour === undefined) return null

  const label = nodeLabel(neighbour.data)
  if (neighbour.type === 'block' && handle) {
    return label ? `"${handle}" of "${label}"` : `the "${handle}" pin of a block`
  }
  return label ? `"${label}"` : null
}

/**
 * Scan every FBD POU body for variable blocks with a blank name.
 *
 * Returns one entry per offending block.  Only FBD bodies are checked:
 * the Ladder editor never lets a variable block go unnamed, and textual
 * bodies cannot express this case.
 */
export function findEmptyFbdVariables(projectData: PLCProjectData): EmptyFbdVariable[] {
  const issues: EmptyFbdVariable[] = []

  for (const pou of projectData.pous) {
    const body = pou.data.body
    if (body.language !== 'fbd') continue
    const rung = body.value.rung

    for (const node of rung.nodes) {
      const kind = VARIABLE_NODE_KINDS[node.type]
      if (kind === undefined) continue

      const name = (node.data as FbdNodeData | undefined)?.variable?.name
      if (name === undefined || name.trim() === '') {
        issues.push({
          pouName: pou.data.name,
          kind,
          connectedTo: describeConnection(node.id, kind, rung),
          x: node.position.x,
          y: node.position.y,
        })
      }
    }
  }

  return issues
}
