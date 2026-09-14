/**
 * Reduce a ladder rung graph back to the series/parallel expression `apply`
 * takes.
 *
 * Not every rung is expressible. The grammar covers a series-parallel
 * two-terminal network, which is what the editor's own parallel OPEN/CLOSE
 * pairs build — but a hand-drawn diagram can contain shapes outside it, and the
 * rung may hold elements the grammar has no word for.
 *
 * When that happens this REFUSES. Emitting a best-effort approximation would
 * mean `describe | apply` quietly redrew someone's diagram, which is worse than
 * telling them the round trip is not available for that POU.
 */

interface RungNode {
  id: string
  type?: string
  data?: Record<string, unknown>
}

interface RungEdge {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

import type { SystemLibrary } from '@root/middleware/shared/ports/library-types'

export type DescribeBodyResult = { ok: true; body: { rungs: unknown[] } } | { ok: false; reason: string }

/**
 * Node types the grammar can name.
 *
 * `variable` is in the list because `addLadderFlow` gives every block data pin
 * its own variable element. They are not described in their own right — they
 * are read back as the block's `inputs`.
 */
const EXPRESSIBLE = new Set(['powerRail', 'contact', 'coil', 'parallel', 'block', 'variable'])

/** Rebuild a block's `type/library/pou` reference from its placed name. */
function resolveCall(
  blockName: string,
  libraries: readonly SystemLibrary[],
  userPouNames: ReadonlySet<string>,
): string | null {
  if (userPouNames.has(blockName)) return `user/${blockName}`
  const owners = libraries.filter((library) => library.pous.some((pou) => pou.name === blockName))
  return owners.length === 1 ? `system/${owners[0].name}/${blockName}` : null
}

export function describeLadderBody(
  value: unknown,
  libraries: readonly SystemLibrary[] = [],
  userPouNames: ReadonlySet<string> = new Set(),
): DescribeBodyResult {
  const flow = value as { rungs?: Array<{ comment?: string; nodes?: RungNode[]; edges?: RungEdge[] }> } | undefined
  if (!flow?.rungs) return { ok: false, reason: 'the body is not a ladder flow' }

  const rungs: unknown[] = []
  for (const rung of flow.rungs) {
    const described = describeRung(rung, libraries, userPouNames)
    if (!described.ok) return described
    rungs.push(described.rung)
  }
  return { ok: true, body: { rungs } }
}

function describeRung(
  rung: { comment?: string; nodes?: RungNode[]; edges?: RungEdge[] },
  libraries: readonly SystemLibrary[],
  userPouNames: ReadonlySet<string>,
): { ok: true; rung: Record<string, unknown> } | { ok: false; reason: string } {
  const nodes = rung.nodes ?? []
  const edges = rung.edges ?? []

  const unknown = nodes.find((node) => !EXPRESSIBLE.has(node.type ?? ''))
  if (unknown) return { ok: false, reason: `the rung holds a "${unknown.type ?? 'nameless'}" element` }

  const byId = new Map(nodes.map((node) => [node.id, node]))
  const outgoing = new Map<string, RungEdge[]>()
  for (const edge of edges) {
    const list = outgoing.get(edge.source) ?? []
    list.push(edge)
    outgoing.set(edge.source, list)
  }

  const leftRail = nodes.find((node) => node.type === 'powerRail' && node.id.startsWith('left-rail'))
  if (!leftRail) return { ok: false, reason: 'the rung has no left power rail' }

  const logic: unknown[] = []
  const outputs: unknown[] = []
  const seen = new Set<string>()

  /**
   * Walk a straight run from `startId` until `stopId` (or the right rail),
   * collecting contacts and following any parallel pair whole.
   */
  function walk(
    startId: string,
    stopId: string | null,
  ): { ok: true; parts: unknown[] } | { ok: false; reason: string } {
    const parts: unknown[] = []
    let cursor: string | undefined = startId

    while (cursor && cursor !== stopId) {
      if (seen.has(cursor)) return { ok: false, reason: 'the rung contains a loop' }
      seen.add(cursor)

      const next = outgoing.get(cursor) ?? []
      if (next.length === 0) break

      const node = byId.get(cursor)
      if (node?.type === 'parallel' && (node.data as { type?: string })?.type === 'open') {
        const built = describeParallel(node)
        if (!built.ok) return built
        parts.push(built.logic)
        cursor = built.closeId
        continue
      }

      // A block has one edge per output pin; the rest go off to their own
      // variable elements. The one that continues the rung is whichever pin the
      // node carries as its output connector — ENO with execution control, the
      // first boolean output without it.
      const power =
        node?.type === 'block'
          ? next.find(
              (edge) => edge.sourceHandle === (node.data as { outputConnector?: { id?: string } })?.outputConnector?.id,
            )
          : next[0]
      if (!power) return { ok: false, reason: 'a block in this rung does not pass power through' }
      if (node?.type !== 'block' && next.length > 1) {
        return { ok: false, reason: 'the rung branches outside a parallel pair' }
      }

      const target = byId.get(power.target)
      if (!target) break

      if (target.type === 'contact') parts.push({ contact: describeElement(target) })
      else if (target.type === 'coil') outputs.push({ coil: describeElement(target) })
      else if (target.type === 'block') {
        const built = describeBlock(target)
        if (!built.ok) return built
        outputs.push(built.output)
      }

      cursor = target.id
    }

    return { ok: true, parts }
  }

  /**
   * A block as a rung output, with the variables sitting on its data pins.
   *
   * Those variables are separate elements carrying `data.block.handleId` — the
   * pin's name — so the map is rebuilt by reading them rather than by position.
   * An unnamed one means the pin was left blank, which is not the same as a pin
   * wired to nothing and is simply omitted.
   */
  function describeBlock(block: RungNode): { ok: true; output: unknown } | { ok: false; reason: string } {
    const data = block.data as { variable?: { name?: string }; variant?: { name?: string } } | undefined
    const blockName = data?.variant?.name
    if (!blockName) return { ok: false, reason: 'a placed block carries no type name' }

    const call = resolveCall(blockName, libraries, userPouNames)
    if (!call) {
      return { ok: false, reason: `no project POU or single installed library provides "${blockName}"` }
    }

    const inputs: Record<string, string> = {}
    const outputs: Record<string, string> = {}
    for (const node of nodes) {
      if (node.type !== 'variable') continue
      const variableData = node.data as
        | {
            block?: { id?: string; handleId?: string; variableType?: { class?: string } }
            variable?: { name?: string }
          }
        | undefined
      if (variableData?.block?.id !== block.id) continue
      const side = variableData.block.variableType?.class
      if (side !== 'input' && side !== 'output') continue
      const pin = variableData.block.handleId
      const name = variableData.variable?.name
      if (pin && name) (side === 'input' ? inputs : outputs)[pin] = name
    }

    // Only worth stating when it is on: `apply` defaults it off, and the editor
    // turns it on by itself for a block that cannot go without it.
    const executionControl = (block.data as { executionControl?: boolean } | undefined)?.executionControl === true

    return {
      ok: true,
      output: {
        block: {
          call,
          ...(data?.variable?.name ? { instance: data.variable.name } : {}),
          ...(executionControl ? { executionControl: true } : {}),
          ...(Object.keys(inputs).length > 0 ? { inputs } : {}),
          ...(Object.keys(outputs).length > 0 ? { outputs } : {}),
        },
      },
    }
  }

  /** An OPEN node and its CLOSE bracket two branches; both are walked whole. */
  function describeParallel(
    open: RungNode,
  ): { ok: true; logic: unknown; closeId: string } | { ok: false; reason: string } {
    const data = open.data as { parallelCloseReference?: string; parallelOutputConnector?: { id?: string } } | undefined
    const closeId = data?.parallelCloseReference
    if (!closeId || !byId.has(closeId)) {
      return { ok: false, reason: 'a parallel branch is missing its closing element' }
    }

    const out = outgoing.get(open.id) ?? []
    const downHandle = data?.parallelOutputConnector?.id
    const straight = out.find((edge) => edge.sourceHandle === 'output-right')
    const down = out.find((edge) => edge.sourceHandle === downHandle)
    if (!straight || !down) return { ok: false, reason: 'a parallel branch is wired in a shape this cannot read' }

    const branches: unknown[] = []
    for (const entry of [straight, down]) {
      const branch = walk(entry.target, closeId)
      if (!branch.ok) return branch
      const node = byId.get(entry.target)
      // `walk` starts AT the branch's first element, so that element is not in
      // its own output — collect it here.
      const head = node?.type === 'contact' ? [{ contact: describeElement(node) }] : node?.type === 'parallel' ? [] : []
      const parts = [...head, ...branch.parts]
      if (parts.length === 0) return { ok: false, reason: 'a parallel branch is empty' }
      branches.push(parts.length === 1 ? parts[0] : { series: parts })
    }

    return { ok: true, logic: { parallel: branches }, closeId }
  }

  const walked = walk(leftRail.id, null)
  if (!walked.ok) return walked
  logic.push(...walked.parts)

  if (outputs.length === 0) return { ok: false, reason: 'the rung drives nothing the grammar can name' }

  return {
    ok: true,
    rung: {
      ...(rung.comment ? { comment: rung.comment } : {}),
      ...(logic.length === 1 ? { logic: logic[0] } : logic.length > 1 ? { logic: { series: logic } } : {}),
      outputs,
    },
  }
}

function describeElement(node: RungNode): { variable: string; variant: string } {
  const data = node.data as { variable?: { name?: string }; variant?: string } | undefined
  return { variable: data?.variable?.name ?? '', variant: data?.variant ?? 'default' }
}
