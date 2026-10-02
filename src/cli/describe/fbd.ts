/**
 * Reduce an FBD rung back to the node/connection list `apply` takes.
 *
 * FBD is the easier direction: the spec's own shape is a node list plus
 * connections, which is close to what the store holds. What is lost is the
 * placement, and that is deliberate — `apply` recomputes it, so a round trip
 * tidies a diagram rather than preserving a hand arrangement.
 *
 * That last point is why a described FBD body is still flagged when it carries
 * anything the grammar has no word for: silently dropping it would make
 * `describe | apply` destructive.
 */

import type { SystemLibrary } from '@root/middleware/shared/ports/library-types'

import type { DescribeBodyResult } from './ladder'

interface FbdNode {
  id: string
  type?: string
  data?: Record<string, unknown>
}

interface FbdEdge {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

/** Node types the spec can name. */
const EXPRESSIBLE = new Set(['block', 'input-variable', 'output-variable', 'inout-variable', 'comment'])

/**
 * Rebuild a block's `system/<library>/<pou>` reference.
 *
 * A placed block records only the block's own name — `variant` carries no
 * library and no version — so the reference has to be recovered by searching
 * the installed pool. One match is the answer; none or several is not
 * guessable, and guessing would put the agent's next `apply` on the wrong
 * library.
 */
function resolveCall(
  blockName: string,
  libraries: readonly SystemLibrary[],
  userPouNames: ReadonlySet<string>,
): string | null {
  // A POU of this project wins: `user/<name>` is unambiguous, and the editor
  // resolves a placed block that way before it looks at any library.
  if (userPouNames.has(blockName)) return `user/${blockName}`
  const owners = libraries.filter((library) => library.pous.some((pou) => pou.name === blockName))
  return owners.length === 1 ? `system/${owners[0].name}/${blockName}` : null
}

export function describeFbdBody(
  value: unknown,
  libraries: readonly SystemLibrary[] = [],
  userPouNames: ReadonlySet<string> = new Set(),
): DescribeBodyResult {
  const flow = value as { rung?: { nodes?: FbdNode[]; edges?: FbdEdge[] } } | undefined
  const nodes = flow?.rung?.nodes
  if (!nodes) return { ok: false, reason: 'the body is not an FBD flow' }

  const unknown = nodes.find((node) => !EXPRESSIBLE.has(node.type ?? ''))
  if (unknown) return { ok: false, reason: `the diagram holds a "${unknown.type ?? 'nameless'}" element` }

  // Labels are spec-local. Store ids are long and regenerated on every apply,
  // so a readable label keeps the document editable by hand.
  const labelById = new Map<string, string>()
  const used = new Set<string>()
  for (const node of nodes) {
    const data = node.data as { variable?: { name?: string }; variant?: { name?: string } } | undefined
    const base = data?.variable?.name || data?.variant?.name || node.type || 'node'
    let label = base
    let suffix = 1
    while (used.has(label)) label = `${base}${(suffix += 1)}`
    used.add(label)
    labelById.set(node.id, label)
  }

  const unresolvedBlocks: string[] = []
  const describedNodes = nodes.map((node) => {
    const data = node.data as { variable?: { name?: string }; variant?: { name?: string }; value?: string } | undefined
    const out: Record<string, unknown> = { label: labelById.get(node.id), kind: node.type }
    if (node.type === 'block') {
      const call = data?.variant?.name ? resolveCall(data.variant.name, libraries, userPouNames) : null
      if (call) out.call = call
      else unresolvedBlocks.push(data?.variant?.name ?? node.id)
      if (data?.variable?.name) out.instance = data.variable.name
      // Only when on: `apply` defaults it off, and the editor turns it on by
      // itself for a block that cannot go without it.
      if ((node.data as { executionControl?: boolean } | undefined)?.executionControl === true) {
        out.executionControl = true
      }
      const order = (node.data as { executionOrder?: number } | undefined)?.executionOrder
      if (order) out.executionOrder = order
    } else if (node.type === 'comment') {
      if (data?.value) out.text = data.value
    } else if (data?.variable?.name) {
      out.variable = data.variable.name
    }
    return out
  })

  // An edge naming a node the diagram does not hold would render as an empty
  // `from` or `to` — the silent flattening this describer exists to refuse.
  const edges = flow?.rung?.edges ?? []
  const dangling = edges.find((edge) => !labelById.has(edge.source) || !labelById.has(edge.target))
  if (dangling) {
    return {
      ok: false,
      reason: `a connection names a node the diagram does not hold ("${dangling.source}" -> "${dangling.target}")`,
    }
  }

  const connections = edges.map((edge) => ({
    from: pinRef(labelById.get(edge.source), edge.sourceHandle),
    to: pinRef(labelById.get(edge.target), edge.targetHandle),
  }))

  if (unresolvedBlocks.length > 0) {
    return {
      ok: false,
      reason: `no project POU or single installed library provides ${unresolvedBlocks.map((name) => `"${name}"`).join(', ')}`,
    }
  }

  return { ok: true, body: { nodes: describedNodes, connections } as never }
}

function pinRef(label: string | undefined, handle: string | null | undefined): string {
  if (!label) return ''
  // A variable node's handle is implied by its direction; only a block's pin
  // needs naming.
  if (!handle || handle === 'input-variable' || handle === 'output-variable') return label
  return `${label}.${handle}`
}
