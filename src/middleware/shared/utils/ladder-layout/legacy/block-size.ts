import {
  blockInputVariables,
  blockOutputVariables,
  IN_OUT_MARKER_WIDTH,
} from '../../../../../frontend/utils/graphical/in-out-pin-rules'
import {
  DEFAULT_BLOCK_CONNECTOR_Y,
  DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
  DEFAULT_BLOCK_WIDTH,
  LEGACY_BLOCK_BOTTOM_PADDING,
  LEGACY_BLOCK_CHAR_WIDTH,
  LEGACY_BLOCK_LABEL_GAP,
} from '../legacy-style'

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
