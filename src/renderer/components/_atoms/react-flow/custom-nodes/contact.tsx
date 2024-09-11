import {
  DefaultContact,
  FallingEdgeContact,
  NegatedContact,
  RisingEdgeContact,
} from '@root/renderer/assets/icons/flow/Contact'
import { cn } from '@root/utils'
import type { Node, NodeProps } from '@xyflow/react'
import { Position } from '@xyflow/react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { InputWithRef } from '../../input'
import { buildHandle, CustomHandle } from './handle'
import type { BasicNodeData, BuilderBasicProps } from './utils/types'

type ContactNode = Node<BasicNodeData & { variant: 'default' | 'negated' | 'risingEdge' | 'fallingEdge' }>
type ContactProps = NodeProps<ContactNode>
type ContactBuilderProps = BuilderBasicProps & { variant: 'default' | 'negated' | 'risingEdge' | 'fallingEdge' }

export const CONTACT_BLOCK_WIDTH = 28
export const CONTACT_BLOCK_HEIGHT = 28

export const CONTACT_CONNECTOR_X = CONTACT_BLOCK_WIDTH
export const CONTACT_CONNECTOR_Y = CONTACT_BLOCK_HEIGHT / 2

type ContactType = {
  [key in ContactNode['data']['variant']]: {
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

export const Contact = ({ selected, data }: ContactProps) => {
  const [contactLabelValue, setContactLabelValue] = useState<string>('')
  const contact = CONTACT_TYPES[data.variant]

  return (
    <div className='relative'>
      <div
        className={cn(
          'rounded-[1px] border border-transparent hover:outline hover:outline-2 hover:outline-offset-[5px] hover:outline-brand',
          {
            'outline outline-2 outline-offset-[5px] outline-brand': selected,
          },
        )}
        style={{ width: CONTACT_BLOCK_WIDTH, height: CONTACT_BLOCK_HEIGHT }}
      >
        {contact.svg}
      </div>
      <div className='absolute -left-[34px] -top-7 w-24'>
        <InputWithRef
          value={contactLabelValue}
          onChange={(e) => setContactLabelValue(e.target.value)}
          placeholder='???'
          className='w-full bg-transparent text-center text-sm outline-none'
        />
      </div>
      {data.handles.map((handle, index) => (
        <CustomHandle key={index} {...handle} />
      ))}
    </div>
  )
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
    relY: CONTACT_CONNECTOR_Y,
    style: { left: -3 },
  })
  const outputHandle = buildHandle({
    id: 'output',
    position: Position.Right,
    isConnectable: false,
    type: 'source',
    glbX: handleX + CONTACT_BLOCK_WIDTH,
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
      variant,
      inputConnector: inputHandle,
      outputConnector: outputHandle,
    },
    width: CONTACT_BLOCK_WIDTH,
    height: CONTACT_BLOCK_HEIGHT,
    draggable: false,
  }
}
