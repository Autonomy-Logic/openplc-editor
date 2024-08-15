import type { Node, NodeProps } from '@xyflow/react'
import { Position } from '@xyflow/react'

import { buildHandle, CustomHandle } from './handle'
import type { BasicNodeData, BuilderBasicProps } from './utils/types'

type ParallelNode = Node<
  BasicNodeData & {
    parallelInputConnector: string | undefined
    parallelOutputConnector: string | undefined
    type: 'open' | 'close'
  }
>
type ParallelProps = NodeProps<ParallelNode>
type ParallelBuilderProps = BuilderBasicProps & { type: 'open' | 'close' }

export const PARALLEL_WIDTH = 30
export const PARALLEL_HEIGHT = 2

export const GAP = 50

export const PARALLEL_CONNECTOR_Y = PARALLEL_HEIGHT/2

export const Parallel = ({ data }: ParallelProps) => {
  return (
    <>
      <svg
        style={{
          width: PARALLEL_WIDTH,
          height: PARALLEL_HEIGHT,
        }}
      >
        <rect
          width={PARALLEL_WIDTH}
          height={PARALLEL_HEIGHT}
          className='stroke-[--xy-edge-stroke-default]'
          fill='none'
        />
      </svg>
      {data.handles.map((handle, index) => (
        <CustomHandle key={index} {...handle} />
      ))}
    </>
  )
}

export const buildParallel = ({ id, posX, posY, handleX, handleY, type }: ParallelBuilderProps) => {
  const handles = [
    buildHandle({
      id: 'input',
      position: Position.Left,
      type: 'target',
      isConnectable: false,
      glbX: handleX,
      glbY: handleY,
      relX: 0,
      relY: PARALLEL_CONNECTOR_Y,
    }),
    buildHandle({
      id: 'output-up',
      position: Position.Right,
      type: 'source',
      isConnectable: false,
      glbX: handleX,
      glbY: handleY,
      relX: PARALLEL_WIDTH,
      relY: PARALLEL_CONNECTOR_Y,
    }),
    buildHandle({
      id: `${type === 'open' ? 'output' : 'input'}-down`,
      position: Position.Bottom,
      type: type === 'open' ? 'source' : 'target',
      isConnectable: false,
      glbX: handleX,
      glbY: handleY,
      relX: PARALLEL_WIDTH / 2,
      relY: PARALLEL_CONNECTOR_Y,
      style: {
        bottom: PARALLEL_CONNECTOR_Y,
      },
    }),
  ]
  return {
    id,
    type: 'parallel',
    position: { x: posX, y: posY },
    data: {
      handles,
      inputConnector: handles[0],
      outputConnector: handles[1],
      parallelInputConnector: type === 'close' ? handles[2] : undefined,
      parallelOutputConnector: type === 'open' ? handles[2] : undefined,
      type,
    },
    width: PARALLEL_WIDTH,
    height: PARALLEL_HEIGHT,
    // draggable: false,
    selectable: false,
  }
}
