import type { Node } from '@xyflow/react'

import type { GraphicalElementModalData } from './types'

/** Narrows an unknown value to a non-null object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Narrows an unknown value to a flow node: an object with a string `id`. */
function isFlowNode(value: unknown): value is Node {
  return isRecord(value) && typeof value.id === 'string'
}

/**
 * Returns the payload of an open graphical element dialog when it belongs to `pouName`.
 *
 * @param modal - The modal state of a graphical element dialog type.
 * @param pouName - The POU bound to the editor asking.
 * @returns The `{ pouName, node }` payload, or `null` when the modal is closed, its data is
 * not a graphical element payload, or it names another POU.
 */
export function graphicalElementModalFor(
  modal: { open: boolean; data: unknown } | undefined,
  pouName: string,
): GraphicalElementModalData | null {
  if (!modal?.open || pouName === '') return null
  const { data } = modal
  if (!isRecord(data) || data.pouName !== pouName || !isFlowNode(data.node)) return null
  return { pouName, node: data.node }
}
