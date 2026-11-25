import type { RungLadderState } from '../../ports/types'
import type { LadderLabelSource } from './labels'
import { applyRungLayout, layoutRung } from './layout'
import { ldSinkOrder } from './sink-order'

/** The rungs of one LD POU converted to the current layout, whether any moved, and what to warn about. */
export interface LadderMigration {
  rungs: RungLadderState[]
  changed: boolean
  warnings: string[]
}

/**
 * The outputs whose order the compiled program follows on its own: sinks that are neither blocks nor fed only by one
 * block (those are emitted with their block's call).
 */
function standaloneSinkOrder(rungs: readonly RungLadderState[]): string[] {
  const types = new Map(rungs.flatMap((rung) => rung.nodes.map((node) => [node.id, node.type] as const)))
  const sources = new Map<string, Set<string>>()
  for (const edge of rungs.flatMap((rung) => rung.edges)) {
    const set = sources.get(edge.target) ?? new Set<string>()
    set.add(edge.source)
    sources.set(edge.target, set)
  }
  return ldSinkOrder(rungs).filter((id) => {
    if (types.get(id) === 'block') return false
    const from = [...(sources.get(id) ?? [])]
    return !(from.length === 1 && types.get(from[0]) === 'block')
  })
}

/** The stored geometry of a rung: every node position and size, and the rung bounds. */
const geometryOf = (rung: RungLadderState): string =>
  JSON.stringify([
    rung.defaultBounds,
    rung.reactFlowViewport,
    rung.nodes.map((node) => [node.id, node.position.x, node.position.y, node.width, node.height]),
  ])

/**
 * Lays out every rung of POU `pouName` with the current engine, geometry only, so pin variable boxes keep their
 * variables. A rung the engine cannot lay out without losing an element keeps its geometry; any other issue, such as a
 * changed compile order, is only reported as a warning.
 */
export function migrateLadderRungs(
  pouName: string,
  rungs: readonly RungLadderState[],
  src: LadderLabelSource,
): LadderMigration {
  const warnings: string[] = []
  let changed = false
  const migrated = rungs.map((rung, index) => {
    let next: RungLadderState
    try {
      next = applyRungLayout(rung, layoutRung(rung, src))
    } catch (error) {
      warnings.push(`${pouName}, rung ${index + 1}: kept as it was, the new layout failed (${String(error)}).`)
      return rung
    }
    const kept = new Set(next.nodes.map((node) => node.id))
    const lost = rung.nodes.filter((node) => !kept.has(node.id)).length
    if (lost > 0) {
      warnings.push(`${pouName}, rung ${index + 1}: kept as it was, the new layout would drop ${lost} element(s).`)
      return rung
    }
    if (geometryOf(next) !== geometryOf(rung)) changed = true
    return next
  })
  if (changed && standaloneSinkOrder(rungs).join('\n') !== standaloneSinkOrder(migrated).join('\n')) {
    warnings.push(`${pouName}: the new layout changes the order of its outputs in the compiled program; review it.`)
  }
  return { rungs: migrated, changed, warnings }
}
