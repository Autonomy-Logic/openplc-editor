import { Position } from '@xyflow/react'

import { generateNumericUUID } from '../../../../utils/generate-uuid'
import { buildHandle } from './handle'
import { getBlockSize, getBlockVariantAndExecutionControl } from './utils'
import {
  DEFAULT_BLOCK_TYPE,
  DEFAULT_COIL_BLOCK_HEIGHT,
  DEFAULT_COIL_BLOCK_WIDTH,
  DEFAULT_COIL_CONNECTOR_Y,
  DEFAULT_CONTACT_BLOCK_HEIGHT,
  DEFAULT_CONTACT_BLOCK_WIDTH,
  DEFAULT_CONTACT_CONNECTOR_Y,
  DEFAULT_PARALLEL_CONNECTOR_Y,
  DEFAULT_PARALLEL_HEIGHT,
  DEFAULT_PARALLEL_WIDTH,
  DEFAULT_PLACEHOLDER_CONNECTOR_Y,
  DEFAULT_PLACEHOLDER_HEIGHT,
  DEFAULT_PLACEHOLDER_WIDTH,
  DEFAULT_POWER_RAIL_CONNECTOR_X,
  DEFAULT_POWER_RAIL_CONNECTOR_Y,
  DEFAULT_POWER_RAIL_HEIGHT,
  DEFAULT_POWER_RAIL_WIDTH,
  DEFAULT_VARIABLE_CONNECTOR_Y,
  DEFAULT_VARIABLE_HEIGHT,
  DEFAULT_VARIABLE_WIDTH,
} from './utils/constants'
import type {
  BlockBuilderProps,
  BlockVariant,
  CoilBuilderProps,
  ContactBuilderProps,
  LadderBlockConnectedVariables,
  ParallelBuilderProps,
  ParallelNode,
  PlaceholderBuilderProps,
  PlaceholderNode,
  PowerRailBuilderProps,
  VariableBuilderProps,
  VariableNode,
} from './utils/types'

/**
 *
 * @param id: string - The id of the block node
 * @param posX: number - The x coordinate of the block node in the flow panel
 * @param posY: number - The y coordinate of the block node in the flow panel
 * @param handleX: number - The x coordinate of the handle based on the global position (inside the flow panel)
 * @param handleY: number - The y coordinate of the handle based on the global position (inside the flow panel)
 * @param blockType: 'template' - The type of the block node
 * @returns BlockNode
 */
export const buildBlockNode = <T extends object | undefined>({
  id,
  posX,
  posY,
  handleX,
  handleY,
  variant,
  executionControl = false,
}: BlockBuilderProps<T>) => {
  const original = [...((variant as BlockVariant)?.variables ?? [])]
  const outIndex = original.findIndex((v) => v.name === 'OUT')
  const variantVariables =
    outIndex > 0 ? [original[outIndex], ...original.slice(0, outIndex), ...original.slice(outIndex + 1)] : original
  const newVariant = variant ? { ...(variant as BlockVariant), variables: variantVariables } : DEFAULT_BLOCK_TYPE

  const {
    variant: variantLib,
    executionControl: executionControlAux,
    lockExecutionControl,
  } = getBlockVariantAndExecutionControl(
    {
      ...(newVariant as BlockVariant),
    },
    executionControl,
  )
  const { handles, leftHandles, rightHandles, height, width } = getBlockSize(variantLib, { x: handleX, y: handleY })

  return {
    id,
    type: 'block',
    position: { x: posX, y: posY },
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
      lockExecutionControl,
      connectedVariables: [] as LadderBlockConnectedVariables,
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

export const buildCoilNode = ({ id, posX, posY, handleX, handleY, variant }: CoilBuilderProps) => {
  const inputHandle = buildHandle({
    id: 'input',
    position: Position.Left,
    isConnectable: false,
    type: 'target',
    glbX: handleX,
    glbY: handleY,
    relX: 0,
    relY: DEFAULT_COIL_CONNECTOR_Y,
    style: { left: -3 },
  })
  const outputHandle = buildHandle({
    id: 'output',
    position: Position.Right,
    isConnectable: false,
    type: 'source',
    glbX: handleX + DEFAULT_COIL_BLOCK_WIDTH,
    glbY: handleY,
    relX: DEFAULT_COIL_BLOCK_WIDTH,
    relY: DEFAULT_COIL_CONNECTOR_Y,
    style: { right: -3 },
  })
  const handles = [inputHandle, outputHandle]

  return {
    id,
    type: 'coil',
    position: { x: posX, y: posY },
    data: {
      handles,
      variant,
      inputHandles: [inputHandle],
      outputHandles: [outputHandle],
      inputConnector: inputHandle,
      outputConnector: outputHandle,
      numericId: generateNumericUUID(),
      variable: { name: '' },
      executionOrder: 0,
      draggable: true,
      selectable: true,
      deletable: true,
    },
    width: DEFAULT_COIL_BLOCK_WIDTH,
    height: DEFAULT_COIL_BLOCK_HEIGHT,
    measured: {
      width: DEFAULT_COIL_BLOCK_WIDTH,
      height: DEFAULT_COIL_BLOCK_HEIGHT,
    },
    draggable: true,
    selectable: true,
    selected: true,
  }
}

export const buildContactNode = ({ id, posX, posY, handleX, handleY, variant }: ContactBuilderProps) => {
  const inputHandle = buildHandle({
    id: 'input',
    position: Position.Left,
    isConnectable: false,
    type: 'target',
    glbX: handleX,
    glbY: handleY,
    relX: 0,
    relY: DEFAULT_CONTACT_CONNECTOR_Y,
    style: { left: -3 },
  })
  const outputHandle = buildHandle({
    id: 'output',
    position: Position.Right,
    isConnectable: false,
    type: 'source',
    glbX: handleX + DEFAULT_CONTACT_BLOCK_WIDTH,
    glbY: handleY,
    relX: DEFAULT_CONTACT_BLOCK_WIDTH,
    relY: DEFAULT_CONTACT_CONNECTOR_Y,
    style: { right: -3 },
  })
  const handles = [inputHandle, outputHandle]

  return {
    id,
    type: 'contact',
    position: { x: posX, y: posY },
    data: {
      handles,
      variant,
      inputHandles: [inputHandle],
      outputHandles: [outputHandle],
      inputConnector: inputHandle,
      outputConnector: outputHandle,
      numericId: generateNumericUUID(),
      variable: { name: '' },
      executionOrder: 0,
      draggable: true,
      selectable: true,
      deletable: true,
    },
    width: DEFAULT_CONTACT_BLOCK_WIDTH,
    height: DEFAULT_CONTACT_BLOCK_HEIGHT,
    measured: {
      width: DEFAULT_CONTACT_BLOCK_WIDTH,
      height: DEFAULT_CONTACT_BLOCK_HEIGHT,
    },
    draggable: true,
    selectable: true,
    selected: true,
  }
}

/**
 *
 * @param id: string - The id of the mock node
 * @param label: string - The label of the mock node
 * @param posX: number - The x coordinate of the mock node in the flow panel
 * @param posY: number - The y coordinate of the mock node in the flow panel
 * @param handleX: number - The x coordinate of the handle based on the global position (inside the flow panel)
 * @param handleY: number - The y coordinate of the handle based on the global position (inside the flow panel)
 * @returns MockNode
 */
export const buildMockNode = ({
  id,
  label,
  posX,
  posY,
  handleX,
  handleY,
}: {
  id: string
  label: string
  posX: number
  posY: number
  handleX: number
  handleY: number
}) => ({
  id,
  type: 'mockNode',
  position: { x: posX, y: posY },
  data: {
    label,
    handles: [
      {
        id: 'left',
        position: 'left',
        type: 'target',
        isConnectable: false,
        glbPosition: {
          x: handleX,
          y: handleY,
        },
        relPosition: {
          x: 0,
          y: 20,
        },
      },
      {
        id: 'right',
        position: 'right',
        type: 'source',
        isConnectable: false,
        glbPosition: {
          x: handleX + 150,
          y: handleY,
        },
        relPosition: {
          x: 150,
          y: 20,
        },
      },
    ],
    inputHandles: [
      {
        id: 'left',
        position: 'left',
        type: 'target',
        isConnectable: false,
        glbPosition: {
          x: handleX,
          y: handleY,
        },
        relPosition: {
          x: 0,
          y: 20,
        },
      },
    ],
    outputHandles: [
      {
        id: 'right',
        position: 'right',
        type: 'source',
        isConnectable: false,
        glbPosition: {
          x: handleX + 150,
          y: handleY,
        },
        relPosition: {
          x: 150,
          y: 20,
        },
      },
    ],
    inputConnector: {
      id: 'left',
      position: 'left',
      type: 'target',
      isConnectable: false,
      glbPosition: {
        x: handleX,
        y: handleY,
      },
      relPosition: {
        x: 0,
        y: 20,
      },
    },
    outputConnector: {
      id: 'right',
      position: 'right',
      type: 'source',
      isConnectable: false,
      glbPosition: {
        x: handleX + 150,
        y: handleY,
      },
      relPosition: {
        x: 150,
        y: 20,
      },
    },
    numericId: generateNumericUUID(),
    variable: { name: '' },
    executionOrder: 0,
    draggable: false,
    selectable: true,
    deletable: true,
  },
  width: 150,
  height: 40,
  measured: {
    width: 150,
    height: 40,
  },
  draggable: false,
  selectable: true,
})

export const buildParallel = ({ id, posX, posY, handleX, handleY, type }: ParallelBuilderProps): ParallelNode => {
  const handles = [
    buildHandle({
      id: 'input',
      position: Position.Left,
      type: 'target',
      isConnectable: false,
      glbX: handleX,
      glbY: handleY,
      relX: 0,
      relY: DEFAULT_PARALLEL_CONNECTOR_Y,
      style: {
        visibility: 'hidden',
        left: 3,
      },
    }),
    buildHandle({
      id: 'output-right',
      position: Position.Right,
      type: 'source',
      isConnectable: false,
      glbX: handleX + DEFAULT_PARALLEL_WIDTH,
      glbY: handleY,
      relX: DEFAULT_PARALLEL_WIDTH,
      relY: DEFAULT_PARALLEL_CONNECTOR_Y,
      style: {
        visibility: 'hidden',
        right: 3,
      },
    }),
    buildHandle({
      id: `${type === 'open' ? 'output' : 'input'}-down`,
      position: Position.Bottom,
      type: type === 'open' ? 'source' : 'target',
      isConnectable: false,
      glbX: handleX + DEFAULT_PARALLEL_WIDTH / 2,
      glbY: handleY + DEFAULT_PARALLEL_HEIGHT,
      relX: DEFAULT_PARALLEL_WIDTH / 2,
      relY: DEFAULT_PARALLEL_HEIGHT,
      style: {
        // visibility: 'hidden',
        bottom: DEFAULT_PARALLEL_CONNECTOR_Y,
      },
    }),
    buildHandle({
      id: `${type === 'close' ? 'output' : 'input'}-top`,
      position: Position.Top,
      type: type === 'close' ? 'source' : 'target',
      isConnectable: false,
      glbX: handleX + DEFAULT_PARALLEL_WIDTH / 2,
      glbY: handleY - DEFAULT_PARALLEL_CONNECTOR_Y,
      relX: DEFAULT_PARALLEL_WIDTH / 2,
      relY: 0,
      style: {
        // visibility: 'hidden',
        top: DEFAULT_PARALLEL_CONNECTOR_Y,
      },
    }),
  ]

  const inputHandles = [handles[0]]
  if (type !== 'open') inputHandles.push(handles[2])
  else inputHandles.push(handles[3])

  const outputHandles = [handles[1]]
  if (type === 'open') outputHandles.push(handles[2])
  else outputHandles.push(handles[3])

  return {
    id,
    type: 'parallel',
    position: { x: posX, y: posY },
    data: {
      handles,
      inputHandles: inputHandles,
      outputHandles: outputHandles,
      inputConnector: handles[0],
      outputConnector: handles[1],
      numericId: generateNumericUUID(),
      parallelInputConnector: type === 'close' ? handles[2] : type === 'open' ? handles[3] : undefined,
      parallelOutputConnector: type === 'open' ? handles[2] : type === 'close' ? handles[3] : undefined,
      parallelOpenReference: undefined,
      parallelCloseReference: undefined,
      type,
      variable: { name: '' },
      executionOrder: 0,
      draggable: false,
      selectable: false,
      deletable: false,
    },
    width: DEFAULT_PARALLEL_WIDTH,
    height: DEFAULT_PARALLEL_HEIGHT,
    measured: {
      width: DEFAULT_PARALLEL_WIDTH,
      height: DEFAULT_PARALLEL_HEIGHT,
    },
    draggable: false,
    selectable: false,
    selected: false,
  }
}

export const builderPlaceholderNode = ({
  id,
  posX,
  posY,
  handleX,
  handleY,
  type,
  position,
  relatedNode = undefined,
}: PlaceholderBuilderProps): PlaceholderNode => {
  const handles = [
    buildHandle({
      id: 'input',
      position: Position.Left,
      type: 'target',
      isConnectable: false,
      glbX: handleX,
      glbY: handleY,
      relX: 0,
      relY: DEFAULT_PLACEHOLDER_CONNECTOR_Y,
      style: {
        visibility: 'hidden',
        top: DEFAULT_PLACEHOLDER_CONNECTOR_Y,
        left: 0,
      },
    }),
    buildHandle({
      id: 'output',
      position: Position.Right,
      type: 'source',
      isConnectable: false,
      glbX: handleX + DEFAULT_PLACEHOLDER_WIDTH,
      glbY: handleY,
      relX: DEFAULT_PLACEHOLDER_WIDTH,
      relY: DEFAULT_PLACEHOLDER_CONNECTOR_Y,
      style: {
        visibility: 'hidden',
        top: DEFAULT_PLACEHOLDER_CONNECTOR_Y,
        right: 0,
      },
    }),
  ]

  return {
    id,
    type: type === 'default' ? 'placeholder' : 'parallelPlaceholder',
    data: {
      handles: handles,
      inputHandles: [handles[0]],
      outputHandles: [handles[1]],
      inputConnector: handles[0],
      outputConnector: handles[1],
      numericId: generateNumericUUID(),
      position,
      relatedNode,
      variable: { name: '' },
      executionOrder: 0,
      draggable: false,
      selectable: true,
      deletable: true,
    },
    position: {
      x: posX,
      y: posY,
    },
    style: {
      width: DEFAULT_PLACEHOLDER_WIDTH,
      height: DEFAULT_PLACEHOLDER_HEIGHT,
    },
    measured: {
      width: DEFAULT_PLACEHOLDER_WIDTH,
      height: DEFAULT_PLACEHOLDER_HEIGHT,
    },
    draggable: false,
    selectable: true,
    selected: false,
  }
}

/**
 *
 * @param id: string - The id of the power rail node
 * @param posX: number - The x coordinate of the power rail node in the flow panel
 * @param posY: number - The y coordinate of the power rail node in the flow panel
 * @param connector: 'left' | 'right' - The connector of the power rail node
 * @param handleX: number - The x coordinate of the handle based on the global position (inside the flow panel)
 * @param handleY: number - The y coordinate of the handle based on the global position (inside the flow panel)
 * @returns PowerRailNode
 */
export const buildPowerRailNode = ({ id, posX, posY, connector, handleX, handleY }: PowerRailBuilderProps) => {
  const handles = [
    buildHandle({
      id: `${connector === 'left' ? 'right' : 'left'}-rail`,
      position: connector === 'left' ? Position.Left : Position.Right,
      type: connector === 'left' ? 'target' : 'source',
      isConnectable: false,
      glbX: handleX,
      glbY: handleY,
      relX: DEFAULT_POWER_RAIL_CONNECTOR_X,
      relY: DEFAULT_POWER_RAIL_CONNECTOR_Y,
      style: {
        top: DEFAULT_POWER_RAIL_CONNECTOR_Y,
        left: connector === 'left' ? -DEFAULT_POWER_RAIL_WIDTH : undefined,
        right: connector === 'right' ? -DEFAULT_POWER_RAIL_WIDTH : undefined,
      },
    }),
  ]

  return {
    id,
    type: 'powerRail',
    position: { x: posX, y: posY },
    data: {
      handles,
      inputHandles: connector === 'left' ? handles : [],
      outputHandles: connector === 'right' ? handles : [],
      inputConnector: connector === 'left' ? handles[0] : undefined,
      outputConnector: connector === 'right' ? handles[0] : undefined,
      numericId: generateNumericUUID(),
      variant: connector === 'right' ? 'left' : 'right',
      variable: { name: '' },
      executionOrder: 0,
      draggable: false,
      selectable: false,
      deletable: false,
    },
    width: DEFAULT_POWER_RAIL_WIDTH,
    height: DEFAULT_POWER_RAIL_HEIGHT,
    measured: {
      width: DEFAULT_POWER_RAIL_WIDTH,
      height: DEFAULT_POWER_RAIL_HEIGHT,
    },
    draggable: false,
    selectable: false,
    selected: false,
  }
}

export const buildVariableNode = ({
  id,
  posX,
  posY,
  handleX,
  handleY,
  variant,
  block,
  variable,
}: VariableBuilderProps): VariableNode => {
  const inputHandle =
    variant === 'output'
      ? buildHandle({
          id: 'input',
          position: Position.Left,
          isConnectable: false,
          type: 'target',
          glbX: handleX,
          glbY: handleY,
          relX: 0,
          relY: DEFAULT_VARIABLE_CONNECTOR_Y,
        })
      : undefined
  const outputHandle =
    variant === 'input'
      ? buildHandle({
          id: 'output',
          position: Position.Right,
          isConnectable: false,
          type: 'source',
          glbX: handleX + DEFAULT_VARIABLE_WIDTH,
          glbY: handleY,
          relX: DEFAULT_VARIABLE_WIDTH,
          relY: DEFAULT_VARIABLE_CONNECTOR_Y,
        })
      : undefined

  return {
    id,
    type: 'variable',
    position: {
      x: posX,
      y: posY,
    },
    width: DEFAULT_VARIABLE_WIDTH,
    height: DEFAULT_VARIABLE_HEIGHT,
    measured: {
      width: DEFAULT_VARIABLE_WIDTH,
      height: DEFAULT_VARIABLE_HEIGHT,
    },
    data: {
      handles: [inputHandle, outputHandle].filter((handle) => handle !== undefined),
      inputHandles: [inputHandle].filter((handle) => handle !== undefined),
      outputHandles: [outputHandle].filter((handle) => handle !== undefined),
      inputConnector: inputHandle,
      outputConnector: outputHandle,
      numericId: generateNumericUUID(),
      variable: variable ?? { name: '' },
      executionOrder: 0,
      variant,
      block,
      draggable: false,
      selectable: true,
      deletable: false,
    },
    deletable: false,
    selectable: true,
    draggable: false,
  }
}
