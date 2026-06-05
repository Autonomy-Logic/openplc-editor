import { Position } from '@xyflow/react'

import { generateNumericUUID } from '../../../../utils/generate-uuid'
import { BlockVariant } from '../types/block'
import { buildHandle } from './handle'
import { getBlockSize, getBlockVariantAndExecutionControl } from './utils'
import {
  CONNECTION_ELEMENT_HEIGHT,
  CONNECTION_ELEMENT_WIDTH,
  DEFAULT_BLOCK_CONNECTOR_Y,
  DEFAULT_BLOCK_TYPE,
  DEFAULT_CONNECTION_CONNECTOR_X,
  DEFAULT_CONNECTION_CONNECTOR_Y,
  DEFAULT_VARIABLE_CONNECTOR_X,
  DEFAULT_VARIABLE_CONNECTOR_Y,
  MINIMUM_ELEMENT_HEIGHT,
  MINIMUM_ELEMENT_WIDTH,
  VARIABLE_ELEMENT_HEIGHT,
  VARIABLE_ELEMENT_SIZE,
} from './utils/constants'
import type {
  BlockBuilderProps,
  CommentBuilderProps,
  CommentNode,
  ConnectionBuilderProps,
  ConnectionNode,
  VariableBuilderProps,
  VariableNode,
} from './utils/types'

/**
 *
 * @param id: string - The id of the block node
 * @param position: { x: number, y: number } - The position of the block node
 * @param variant: 'template' - The type of the block node
 * @returns BlockNode
 */
export const buildBlockNode = <T extends object | undefined>({
  id,
  position,
  variant,
  executionControl = false,
}: BlockBuilderProps<T>) => {
  let variantVariables = [...((variant as BlockVariant)?.variables ?? [])]
  const outIndex = variantVariables.findIndex((v) => v.name === 'OUT')
  if (outIndex > 0) {
    const [outVar] = variantVariables.splice(outIndex, 1)
    variantVariables = [outVar, ...variantVariables]
  }
  const newVariant = variant ? { ...(variant as BlockVariant), variables: variantVariables } : DEFAULT_BLOCK_TYPE
  const { variant: variantLib, executionControl: executionControlAux } = getBlockVariantAndExecutionControl(
    { ...(newVariant as BlockVariant) },
    executionControl,
  )

  const handlePosition = {
    x: position.x,
    y: position.y + DEFAULT_BLOCK_CONNECTOR_Y,
  }
  const { handles, leftHandles, rightHandles, height, width } = getBlockSize(variantLib, handlePosition)

  return {
    id,
    type: 'block',
    position,
    data: {
      handles,
      inputHandles: leftHandles,
      outputHandles: rightHandles,
      inputConnector: leftHandles[0],
      outputConnector: rightHandles[0],
      numericId: generateNumericUUID(),
      variant: variantLib,
      variable: { name: '' },
      executionOrder: 0,
      executionControl: executionControlAux,
      draggable: true,
      selectable: true,
      deletable: true,
    },
    width,
    height,
    measured: {
      width,
      height,
    },
    draggable: true,
    selectable: true,
    selected: variantLib.type === 'function' ? false : true,
  }
}

export const buildCommentNode = ({ id, position }: CommentBuilderProps): CommentNode => {
  return {
    id,
    type: 'comment',
    position,
    width: MINIMUM_ELEMENT_WIDTH,
    height: MINIMUM_ELEMENT_HEIGHT,
    measured: {
      width: MINIMUM_ELEMENT_WIDTH,
      height: MINIMUM_ELEMENT_HEIGHT,
    },
    data: {
      numericId: generateNumericUUID(),
      draggable: true,
      selectable: true,
      deletable: true,
      content: '',
    },
    deletable: true,
    selectable: true,
    draggable: true,
    selected: true,
  }
}

export const buildConnectionNode = ({ id, position, variant, label }: ConnectionBuilderProps): ConnectionNode => {
  const inputHandle =
    variant === 'connector'
      ? buildHandle({
          id: 'input',
          position: Position.Left,
          type: 'target',
          glbX: position.x,
          glbY: position.y + DEFAULT_CONNECTION_CONNECTOR_Y,
          relX: 0,
          relY: DEFAULT_CONNECTION_CONNECTOR_Y,
        })
      : undefined
  const outputHandle =
    variant === 'continuation'
      ? buildHandle({
          id: 'output',
          position: Position.Right,
          type: 'source',
          glbX: position.x + DEFAULT_CONNECTION_CONNECTOR_X,
          glbY: position.y + DEFAULT_CONNECTION_CONNECTOR_Y,
          relX: DEFAULT_CONNECTION_CONNECTOR_X,
          relY: DEFAULT_CONNECTION_CONNECTOR_Y,
        })
      : undefined

  return {
    id,
    type: variant,
    position,
    width: CONNECTION_ELEMENT_WIDTH,
    height: CONNECTION_ELEMENT_HEIGHT,
    measured: {
      width: CONNECTION_ELEMENT_WIDTH,
      height: CONNECTION_ELEMENT_HEIGHT,
    },
    data: {
      handles: [inputHandle, outputHandle].filter((handle) => handle !== undefined),
      inputHandles: [inputHandle].filter((handle) => handle !== undefined),
      outputHandles: [outputHandle].filter((handle) => handle !== undefined),
      inputConnector: inputHandle,
      outputConnector: outputHandle,
      numericId: generateNumericUUID(),
      executionOrder: 0,
      variant,
      variable: label ? { id: 'connection', name: label } : { id: '', name: '' },
      draggable: true,
      selectable: true,
      deletable: true,
    },
    deletable: true,
    selectable: true,
    draggable: true,
    selected: true,
  }
}

export const buildVariableNode = ({ id, position, variant }: VariableBuilderProps): VariableNode => {
  const inputHandle =
    variant === 'output-variable' || variant === 'inout-variable'
      ? buildHandle({
          id: 'input-variable',
          position: Position.Left,
          type: 'target',
          glbX: position.x,
          glbY: position.y + DEFAULT_VARIABLE_CONNECTOR_Y,
          relX: 0,
          relY: DEFAULT_VARIABLE_CONNECTOR_Y,
        })
      : undefined
  const outputHandle =
    variant === 'input-variable' || variant === 'inout-variable'
      ? buildHandle({
          id: 'output-variable',
          position: Position.Right,
          type: 'source',
          glbX: position.x + DEFAULT_VARIABLE_CONNECTOR_X,
          glbY: position.y + DEFAULT_VARIABLE_CONNECTOR_Y,
          relX: DEFAULT_VARIABLE_CONNECTOR_X,
          relY: DEFAULT_VARIABLE_CONNECTOR_Y,
        })
      : undefined

  return {
    id,
    type: variant,
    position,
    width: VARIABLE_ELEMENT_SIZE,
    height: VARIABLE_ELEMENT_HEIGHT,
    measured: {
      width: VARIABLE_ELEMENT_SIZE,
      height: VARIABLE_ELEMENT_HEIGHT,
    },
    data: {
      handles: [inputHandle, outputHandle].filter((handle) => handle !== undefined),
      inputHandles: [inputHandle].filter((handle) => handle !== undefined),
      outputHandles: [outputHandle].filter((handle) => handle !== undefined),
      inputConnector: inputHandle,
      outputConnector: outputHandle,
      numericId: generateNumericUUID(),
      variable: { id: '', name: '' },
      executionOrder: 0,
      variant,
      negated: false,
      draggable: true,
      selectable: true,
      deletable: true,
    },
    deletable: true,
    selectable: true,
    draggable: true,
    selected: true,
  }
}
