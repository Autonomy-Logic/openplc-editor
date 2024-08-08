import {
  DefaultContact,
  FallingEdgeContact,
  NegatedContact,
  RisingEdgeContact,
} from '@root/renderer/assets/icons/flow/Contact'
import type { Node, NodeProps } from '@xyflow/react'
import { Position } from '@xyflow/react'
import type { ReactNode } from 'react'

import type { CustomHandleProps } from './handle'
import { buildHandle, CustomHandle } from './handle'

type ContactNode = Node<
  { handles: CustomHandleProps[]; variation: 'default' | 'negated' | 'risingEdge' | 'fallingEdge' },
  'text'
>
type ContactProps = NodeProps<ContactNode>

export const CONTACT_BLOCK_WIDTH = 50
export const CONTACT_BLOCK_HEIGHT = 50

export const CONTACT_CONNECTOR_X = CONTACT_BLOCK_WIDTH
export const CONTACT_CONNECTOR_Y = CONTACT_BLOCK_HEIGHT / 2

type ContactType = {
  [key in ContactNode['data']['variation']]: {
    svg: ReactNode
  }
}
const CONTACT_TYPES: ContactType = {
  default: {
    svg: <DefaultContact width={CONTACT_BLOCK_WIDTH} height={CONTACT_BLOCK_HEIGHT} />,
  },
  negated: {
    svg: <NegatedContact width={CONTACT_BLOCK_WIDTH} height={CONTACT_BLOCK_HEIGHT} />,
  },
  risingEdge: {
    svg: <RisingEdgeContact width={CONTACT_BLOCK_WIDTH} height={CONTACT_BLOCK_HEIGHT} />,
  },
  fallingEdge: {
    svg: <FallingEdgeContact width={CONTACT_BLOCK_WIDTH} height={CONTACT_BLOCK_HEIGHT} />,
  },
}

export const Contact = ({ data }: ContactProps) => {
  const contact = CONTACT_TYPES[data.variation]

  return (
    <>
      <div style={{ width: CONTACT_BLOCK_WIDTH, height: CONTACT_BLOCK_HEIGHT }}>{contact.svg}</div>
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
