import {
  DefaultCoil,
  FallingEdgeCoil,
  NegatedCoil,
  ResetCoil,
  RisingEdgeCoil,
  SetCoil,
} from '@root/renderer/assets/icons/flow/Coil'
import { cn } from '@root/utils'
import type { Node, NodeProps } from '@xyflow/react'
import { Position } from '@xyflow/react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { InputWithRef } from '../../input'
import { buildHandle, CustomHandle } from './handle'
import type { BasicNodeData, BuilderBasicProps } from './utils/types'

type CoilNode = Node<
  BasicNodeData & {
    variant: 'default' | 'negated' | 'risingEdge' | 'fallingEdge' | 'set' | 'reset'
  }
>
type CoilProps = NodeProps<CoilNode>
type CoilBuilderProps = BuilderBasicProps & {
  variant: 'default' | 'negated' | 'risingEdge' | 'fallingEdge' | 'set' | 'reset'
}

export const COIL_BLOCK_WIDTH = 34
export const COIL_BLOCK_HEIGHT = 28

export const COIL_CONNECTOR_X = COIL_BLOCK_WIDTH
export const COIL_CONNECTOR_Y = COIL_BLOCK_HEIGHT / 2

type CoilType = {
  [key in CoilNode['data']['variant']]: {
    svg: ReactNode
  }
}
const COIL_TYPES: CoilType = {
  default: {
    svg: (
      <DefaultCoil
        width={COIL_BLOCK_WIDTH}
        height={COIL_BLOCK_HEIGHT}
        parenthesesClassName='fill-neutral-1000 dark:fill-neutral-100'
      />
    ),
  },
  negated: {
    svg: (
      <NegatedCoil
        width={COIL_BLOCK_WIDTH}
        height={COIL_BLOCK_HEIGHT}
        parenthesesClassName='fill-neutral-1000 dark:fill-neutral-100'
      />
    ),
  },
  risingEdge: {
    svg: (
      <RisingEdgeCoil
        width={COIL_BLOCK_WIDTH}
        height={COIL_BLOCK_HEIGHT}
        parenthesesClassName='fill-neutral-1000 dark:fill-neutral-100'
      />
    ),
  },
  fallingEdge: {
    svg: (
      <FallingEdgeCoil
        width={COIL_BLOCK_WIDTH}
        height={COIL_BLOCK_HEIGHT}
        parenthesesClassName='fill-neutral-1000 dark:fill-neutral-100'
      />
    ),
  },
  set: {
    svg: (
      <SetCoil
        width={COIL_BLOCK_WIDTH}
        height={COIL_BLOCK_HEIGHT}
        parenthesesClassName='fill-neutral-1000 dark:fill-neutral-100'
      />
    ),
  },
  reset: {
    svg: (
      <ResetCoil
        width={COIL_BLOCK_WIDTH}
        height={COIL_BLOCK_HEIGHT}
        parenthesesClassName='fill-neutral-1000 dark:fill-neutral-100'
      />
    ),
  },
}

export const Coil = ({ selected, data }: CoilProps) => {
  const [coilLabelValue, setCoilLabelValue] = useState<string>('???')
  const coil = COIL_TYPES[data.variant]

  return (
    <div className='relative'>
      <div
        className={cn(
          'rounded-[1px] border border-transparent hover:outline hover:outline-2 hover:outline-offset-[5px] hover:outline-brand',
          {
            'outline outline-2 outline-offset-[5px] outline-brand': selected,
          },
        )}
        style={{ width: COIL_BLOCK_WIDTH, height: COIL_BLOCK_HEIGHT }}
      >
        {coil.svg}
      </div>
      <div className='absolute -left-[31px] -top-7 w-24'>
        <InputWithRef
          value={coilLabelValue}
          onChange={(e) => setCoilLabelValue(e.target.value)}
          className='w-full bg-transparent text-center text-sm outline-none'
        />
      </div>
      {data.handles.map((handle, index) => (
        <CustomHandle key={index} {...handle} />
      ))}
    </div>
  )
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
    relY: COIL_CONNECTOR_Y,
    style: { left: -3 },
  })
  const outputHandle = buildHandle({
    id: 'output',
    position: Position.Right,
    isConnectable: false,
    type: 'source',
    glbX: handleX,
    glbY: handleY,
    relX: COIL_BLOCK_WIDTH,
    relY: COIL_CONNECTOR_Y,
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
      inputConnector: inputHandle,
      outputConnector: outputHandle,
    },
    width: COIL_BLOCK_WIDTH,
    height: COIL_BLOCK_HEIGHT,
    draggable: false,
  }
}
