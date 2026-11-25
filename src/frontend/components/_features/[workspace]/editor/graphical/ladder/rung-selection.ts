/** How a click on a rung number changes the selected rungs. */
export interface RungSelectOptions {
  /** Shift held: the rung joins the selection, or leaves it when already in. */
  extend?: boolean
  /** A plain click on the only selected rung clears the selection; a right click never does. */
  toggle?: boolean
}

/** The selected rungs after a click on rung `rungId`. */
export function nextRungSelection(
  current: readonly string[],
  rungId: string,
  { extend = false, toggle = true }: RungSelectOptions = {},
): string[] {
  if (extend) return current.includes(rungId) ? current.filter((id) => id !== rungId) : [...current, rungId]
  if (toggle && current.length === 1 && current[0] === rungId) return []
  if (!toggle && current.includes(rungId)) return [...current]
  return [rungId]
}

/**
 * The rungs after a drag of `activeId` dropped on `overId`: the dragged rung, with every other selected rung when it is
 * selected, moves as one block in its current order and without gaps, after `overId` when dragged down and before it
 * when dragged up. Dropped on a rung of the block, nothing moves.
 */
export function moveRungs<T extends { id: string }>(
  rungs: readonly T[],
  selected: ReadonlySet<string>,
  activeId: string,
  overId: string,
): T[] {
  const moving = selected.has(activeId) ? selected : new Set([activeId])
  if (moving.has(overId)) return [...rungs]
  const block = rungs.filter((rung) => moving.has(rung.id))
  const rest = rungs.filter((rung) => !moving.has(rung.id))
  const down = rungs.findIndex((rung) => rung.id === overId) > rungs.findIndex((rung) => rung.id === activeId)
  const overAt = rest.findIndex((rung) => rung.id === overId)
  if (overAt < 0) return [...rungs]
  const insertAt = down ? overAt + 1 : overAt
  return [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)]
}
