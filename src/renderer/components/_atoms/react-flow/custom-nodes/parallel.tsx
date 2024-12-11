import { cn, generateNumericUUID } from '@root/utils'
import type { Node, NodeProps } from '@xyflow/react'
import { Position } from '@xyflow/react'

import { buildHandle, CustomHandle, CustomHandleProps } from './handle'
import type { BasicNodeData, BuilderBasicProps } from './utils/types'

export type ParallelNode = Node<
  BasicNodeData & {
    parallelInputConnector: CustomHandleProps | undefined
    parallelOutputConnector: CustomHandleProps | undefined
    parallelOpenReference: string | undefined
    parallelCloseReference: string | undefined
    type: 'open' | 'close'
  }
>
type ParallelProps = NodeProps<ParallelNode>
type ParallelBuilderProps = BuilderBasicProps & { type: 'open' | 'close' }

export const DEFAULT_PARALLEL_WIDTH = 30
export const DEFAULT_PARALLEL_HEIGHT = 2

export const GAP = 50

export const DEFAULT_PARALLEL_CONNECTOR_Y = DEFAULT_PARALLEL_HEIGHT / 2

export const Parallel = ({ selected, data }: ParallelProps) => {
  return (
    <>
      <div
        className={cn('hover:ring-2 hover:ring-brand', {
          'ring-2 ring-brand': selected,
        })}
        style={{
          width: DEFAULT_PARALLEL_WIDTH,
          height: DEFAULT_PARALLEL_HEIGHT,
        }}
      >
        <svg
          style={{
            width: DEFAULT_PARALLEL_WIDTH,
            height: DEFAULT_PARALLEL_HEIGHT,
          }}
        >
          <rect
            width={DEFAULT_PARALLEL_WIDTH}
            height={DEFAULT_PARALLEL_HEIGHT}
            className='stroke-[--xy-edge-stroke-default]'
            fill='none'
          />
        </svg>
      </div>
      {data.handles.map((handle, index) => (
        <CustomHandle key={index} {...handle} />
      ))}
    </>
  )
}

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
      id: 'output-up',
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
      glbY: handleY,
      relX: DEFAULT_PARALLEL_WIDTH / 2,
      relY: DEFAULT_PARALLEL_CONNECTOR_Y,
      style: {
        // visibility: 'hidden',
        bottom: DEFAULT_PARALLEL_CONNECTOR_Y,
      },
    }),
  ]

  const inputHandles = [handles[0]]
  type !== 'open' && inputHandles.push(handles[2])

  const outputHandles = [handles[1]]
  type === 'open' && outputHandles.push(handles[2])

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
      parallelInputConnector: type === 'close' ? handles[2] : undefined,
      parallelOutputConnector: type === 'open' ? handles[2] : undefined,
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
