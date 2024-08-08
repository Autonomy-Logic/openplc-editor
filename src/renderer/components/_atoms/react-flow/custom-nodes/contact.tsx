import type { Node, NodeProps } from '@xyflow/react'
import { Position } from '@xyflow/react'

import type { CustomHandleProps } from './handle'
import { buildHandle, CustomHandle } from './handle'

type ContactNode = Node<
  { handles: CustomHandleProps[]; variation: 'default' | 'negated' | 'risingEdge' | 'fallingEdge' },
  'text'
>
type ContactProps = NodeProps<ContactNode>

export const CONTACT_WIDTH = 2
export const CONTACT_BLOCK_WIDTH = 50
export const CONTACT_BLOCK_HEIGHT = 50

export const CONTACT_CONNECTOR_X = CONTACT_WIDTH
export const CONTACT_CONNECTOR_Y = CONTACT_BLOCK_HEIGHT / 2

type ContactType = {
  [key in ContactNode['data']['variation']]: {
    label: string
  }
}
const _CONTACT_TYPES: ContactType = {
  default: {
    label: '',
  },
  negated: {
    label: '/',
  },
  risingEdge: {
    label: 'P',
  },
  fallingEdge: {
    label: 'N',
  },
}

export const Contact = ({ data }: ContactProps) => {
  // const contact = CONTACT_TYPES[data.variation]

  return (
    <>
      <div style={{ width: CONTACT_BLOCK_WIDTH, height: CONTACT_BLOCK_HEIGHT }}>
        <svg
          width={CONTACT_BLOCK_WIDTH}
          height={CONTACT_BLOCK_HEIGHT}
          viewBox='0 0 28 28'
          fill='none'
          xmlns='http://www.w3.org/2000/svg'
        >
          <line x1='26.75' x2='26.75' y2='28' stroke='#030303' stroke-width='1.5' />
          <line x1='0.75' x2='0.75' y2='28' stroke='#030303' stroke-width='1.5' />
          <path
            d='M11.0568 18V9.27273H14.0057C14.6903 9.27273 15.25 9.39631 15.6847 9.64347C16.1222 9.88778 16.446 10.2188 16.6562 10.6364C16.8665 11.054 16.9716 11.5199 16.9716 12.0341C16.9716 12.5483 16.8665 13.0156 16.6562 13.4361C16.4489 13.8565 16.1278 14.1918 15.6932 14.4418C15.2585 14.6889 14.7017 14.8125 14.0227 14.8125H11.9091V13.875H13.9886C14.4574 13.875 14.8338 13.794 15.1179 13.6321C15.402 13.4702 15.608 13.2514 15.7358 12.9759C15.8665 12.6974 15.9318 12.3835 15.9318 12.0341C15.9318 11.6847 15.8665 11.3722 15.7358 11.0966C15.608 10.821 15.4006 10.6051 15.1136 10.4489C14.8267 10.2898 14.446 10.2102 13.9716 10.2102H12.1136V18H11.0568Z'
            fill='#0464FB'
          />
        </svg>
      </div>
      {data.handles.map((handle, index) => (
        <CustomHandle key={index} {...handle} />
      ))}
    </>
  )
}

export const buildContactNode = ({
  id,
  posX,
  posY,
  handleX,
  handleY,
  variation = 'default',
}: {
  id: string
  posX: number
  posY: number
  handleX: number
  handleY: number
  variation?: 'default' | 'negated' | 'risingEdge' | 'fallingEdge'
}) => {
  const inputHandle = buildHandle({
    id: 'input',
    position: Position.Left,
    type: 'target',
    glbX: handleX,
    glbY: handleY,
    relX: 0,
    relY: CONTACT_CONNECTOR_Y,
  })
  const outputHandle = buildHandle({
    id: 'output',
    position: Position.Right,
    type: 'source',
    glbX: handleX,
    glbY: handleY,
    relX: CONTACT_BLOCK_WIDTH,
    relY: CONTACT_CONNECTOR_Y,
  })
  const handles = [inputHandle, outputHandle]

  return {
    id,
    type: 'contact',
    position: { x: posX, y: posY },
    data: {
      handles,
      variation,
    },
  }
}
