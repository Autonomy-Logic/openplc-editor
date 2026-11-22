import type { Node } from '@xyflow/react'

import {
  blockInputVariables,
  blockOutputVariables,
  IN_OUT_MARKER_WIDTH,
} from '../../../../../frontend/utils/graphical/in-out-pin-rules'
import type { RungLadderState } from '../../../ports/types'
import {
  DEFAULT_BLOCK_CONNECTOR_Y,
  DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
  DEFAULT_BLOCK_WIDTH,
  DEFAULT_RUNG_BOUNDS,
  LEGACY_BLOCK_BOTTOM_PADDING,
  LEGACY_BLOCK_CHAR_WIDTH,
  LEGACY_BLOCK_LABEL_GAP,
} from '../legacy-style'
import { isRecord } from '../node-data'

/** What block sizing reads off a block variant: its name and each parameter's name and class. */
export type LegacySizableVariant = { name: string; variables: { name: string; class: string }[] }

/** A block's width, from its name and pin labels (capped at the default block width), and its height, from its pin rows. */
export const legacyBlockSize = (variant: LegacySizableVariant): { width: number; height: number } => {
  const inputVariables = blockInputVariables(variant.variables)
  const outputVariables = blockOutputVariables(variant.variables)

  const height =
    DEFAULT_BLOCK_CONNECTOR_Y +
    LEGACY_BLOCK_BOTTOM_PADDING +
    Math.max(inputVariables.length - 1, outputVariables.length - 1) * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET

  let variableInputWidth = 0
  let variableOutputWidth = 0
  const blockNameWidth = variant.name.length * LEGACY_BLOCK_CHAR_WIDTH
  inputVariables.forEach((input) => {
    const inputWidth = input.name.length * LEGACY_BLOCK_CHAR_WIDTH + (input.class === 'inOut' ? IN_OUT_MARKER_WIDTH : 0)
    if (inputWidth > variableInputWidth) variableInputWidth = inputWidth
  })
  outputVariables.forEach((output) => {
    const outputWidth = output.name.length * LEGACY_BLOCK_CHAR_WIDTH
    if (outputWidth > variableOutputWidth) variableOutputWidth = outputWidth
  })

  const width = Math.min(
    Math.max(variableInputWidth + LEGACY_BLOCK_LABEL_GAP + variableOutputWidth, blockNameWidth),
    DEFAULT_BLOCK_WIDTH,
  )

  return { width, height }
}

/** Type guard for a value carrying everything `legacyBlockSize` reads; project-file data may lack any of it. */
export const isSizableVariant = (value: unknown): value is LegacySizableVariant => {
  if (!isRecord(value)) return false
  const { name, variables } = value
  return (
    typeof name === 'string' &&
    Array.isArray(variables) &&
    variables.every(
      (entry: unknown) => isRecord(entry) && typeof entry.name === 'string' && typeof entry.class === 'string',
    )
  )
}

/** A block node given the size its variant calls for; any other node, or a block without a sizable variant, unchanged. */
export const sizeBlockNode = (node: Node): Node => {
  if (node.type !== 'block') return node
  const variant: unknown = node.data?.variant
  if (!isSizableVariant(variant)) return node
  const { width, height } = legacyBlockSize(variant)
  return {
    ...node,
    width,
    height,
    measured: { width, height },
  }
}

/** The rung's `defaultBounds`, each extent replaced by `DEFAULT_RUNG_BOUNDS` when it is not a positive finite number. */
export const legacyRungBounds = (rung: RungLadderState): [number, number] => {
  const [width, height] = Array.isArray(rung.defaultBounds) ? rung.defaultBounds : []
  return [
    Number.isFinite(width) && width > 0 ? width : DEFAULT_RUNG_BOUNDS[0],
    Number.isFinite(height) && height > 0 ? height : DEFAULT_RUNG_BOUNDS[1],
  ]
}
