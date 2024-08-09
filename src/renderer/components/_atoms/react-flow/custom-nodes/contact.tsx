import {
  DefaultContact,
  FallingEdgeContact,
  NegatedContact,
  RisingEdgeContact,
} from '@root/renderer/assets/icons/flow/Contact'
import type { Node, NodeProps } from '@xyflow/react'
import { Position } from '@xyflow/react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { InputWithRef } from '../../input'
import type { CustomHandleProps } from './handle'
import { buildHandle, CustomHandle } from './handle'

type ContactNode = Node<
  { handles: CustomHandleProps[]; variation: 'default' | 'negated' | 'risingEdge' | 'fallingEdge' },
  'text'
>
type ContactProps = NodeProps<ContactNode>

export const CONTACT_BLOCK_WIDTH = 28
export const CONTACT_BLOCK_HEIGHT = 28

export const CONTACT_CONNECTOR_X = CONTACT_BLOCK_WIDTH
export const CONTACT_CONNECTOR_Y = CONTACT_BLOCK_HEIGHT / 2

type ContactType = {
  [key in ContactNode['data']['variation']]: {
    svg: ReactNode
  }
}
const CONTACT_TYPES: ContactType = {
  default: {
    svg: (
      <DefaultContact
        width={CONTACT_BLOCK_WIDTH}
        height={CONTACT_BLOCK_HEIGHT}
        strokeClassName='stroke-neutral-1000 dark:stroke-neutral-100'
      />
    ),
  },
  negated: {
    svg: (
      <NegatedContact
        width={CONTACT_BLOCK_WIDTH}
        height={CONTACT_BLOCK_HEIGHT}
        strokeClassName='stroke-neutral-1000 dark:stroke-neutral-100'
      />
    ),
  },
  risingEdge: {
    svg: (
      <RisingEdgeContact
        width={CONTACT_BLOCK_WIDTH}
        height={CONTACT_BLOCK_HEIGHT}
        strokeClassName='stroke-neutral-1000 dark:stroke-neutral-100'
      />
    ),
  },
  fallingEdge: {
    svg: (
      <FallingEdgeContact
        width={CONTACT_BLOCK_WIDTH}
        height={CONTACT_BLOCK_HEIGHT}
        strokeClassName='stroke-neutral-1000 dark:stroke-neutral-100'
      />
    ),
  },
}

export const Contact = ({ data }: ContactProps) => {
  const [contactLabelValue, setContactLabelValue] = useState<string>('???')
  const contact = CONTACT_TYPES[data.variation]

  return (
    <div className='relative'>
      <div style={{ width: CONTACT_BLOCK_WIDTH, height: CONTACT_BLOCK_HEIGHT }}>{contact.svg}</div>
      <div className='absolute -left-[34px] -top-7 w-24'>
        <InputWithRef
          value={contactLabelValue}
          onChange={(e) => setContactLabelValue(e.target.value)}
          className='w-full bg-transparent text-center text-sm outline-none'
        />
      </div>
      {data.handles.map((handle, index) => (
        <CustomHandle key={index} {...handle} />
      ))}
    </div>
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
    style: { left: -3 },
  })
  const outputHandle = buildHandle({
    id: 'output',
    position: Position.Right,
    type: 'source',
    glbX: handleX,
    glbY: handleY,
    relX: CONTACT_BLOCK_WIDTH,
    relY: CONTACT_CONNECTOR_Y,
    style: { right: -3 },
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
    draggable: false,
  }
}
