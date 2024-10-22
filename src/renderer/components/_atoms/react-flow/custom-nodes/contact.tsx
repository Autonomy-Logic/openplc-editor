import {
  DefaultContact,
  FallingEdgeContact,
  NegatedContact,
  RisingEdgeContact,
} from '@root/renderer/assets/icons/flow/Contact'
import { useOpenPLCStore } from '@root/renderer/store'
import type { RungState } from '@root/renderer/store/slices'
import type { PLCVariable } from '@root/types/PLC'
import { cn, generateNumericUUID } from '@root/utils'
import type { Node, NodeProps } from '@xyflow/react'
import { Position } from '@xyflow/react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { InputWithRef } from '../../input'
import { buildHandle, CustomHandle } from './handle'
import type { BasicNodeData, BuilderBasicProps } from './utils/types'

export type ContactNode = Node<BasicNodeData & { variant: 'default' | 'negated' | 'risingEdge' | 'fallingEdge' }>
type ContactProps = NodeProps<ContactNode>
type ContactBuilderProps = BuilderBasicProps & { variant: 'default' | 'negated' | 'risingEdge' | 'fallingEdge' }

export const DEFAULT_CONTACT_BLOCK_WIDTH = 28
export const DEFAULT_CONTACT_BLOCK_HEIGHT = 28

export const DEFAULT_CONTACT_CONNECTOR_X = DEFAULT_CONTACT_BLOCK_WIDTH
export const DEFAULT_CONTACT_CONNECTOR_Y = DEFAULT_CONTACT_BLOCK_HEIGHT / 2

type ContactType = {
  [key in ContactNode['data']['variant']]: {
    svg: ReactNode
  }
}
export const DEFAULT_CONTACT_TYPES: ContactType = {
  default: {
    svg: (
      <DefaultContact
        width={DEFAULT_CONTACT_BLOCK_WIDTH}
        height={DEFAULT_CONTACT_BLOCK_HEIGHT}
        strokeClassName='stroke-neutral-1000 dark:stroke-neutral-100'
      />
    ),
  },
  negated: {
    svg: (
      <NegatedContact
        width={DEFAULT_CONTACT_BLOCK_WIDTH}
        height={DEFAULT_CONTACT_BLOCK_HEIGHT}
        strokeClassName='stroke-neutral-1000 dark:stroke-neutral-100'
      />
    ),
  },
  risingEdge: {
    svg: (
      <RisingEdgeContact
        width={DEFAULT_CONTACT_BLOCK_WIDTH}
        height={DEFAULT_CONTACT_BLOCK_HEIGHT}
        strokeClassName='stroke-neutral-1000 dark:stroke-neutral-100'
      />
    ),
  },
  fallingEdge: {
    svg: (
      <FallingEdgeContact
        width={DEFAULT_CONTACT_BLOCK_WIDTH}
        height={DEFAULT_CONTACT_BLOCK_HEIGHT}
        strokeClassName='stroke-neutral-1000 dark:stroke-neutral-100'
      />
    ),
  },
}

export const Contact = ({ selected, data, id }: ContactProps) => {
  const {
    editor,
    project: {
      data: { pous },
    },
    flowActions: { updateNode },
  } = useOpenPLCStore()

  const [contactVariableValue, setContactVariableValue] = useState<string>('')
  const contact = DEFAULT_CONTACT_TYPES[data.variant]

  const handleVariableInputOnBlur = () => {
    let variables: PLCVariable[] = []
    let rung: RungState | undefined = undefined
    let node: Node | undefined = undefined

    pous.forEach((pou) => {
      if (pou.data.name === editor.meta.name) {
        variables = pou.data.variables as PLCVariable[]
        rung =
          pou.data.body.language === 'ld'
            ? (pou.data.body.value.rungs.find((rung) =>
                rung.nodes.some((node) => node.id === id) ? rung : undefined,
              ) as RungState)
            : undefined
      }
    })

    if (!variables.some((variable) => variable.name === contactVariableValue)) return
    if (!rung) return

    node = (rung as RungState).nodes.find((node) => node.id === id)
    if (!node) return

    updateNode({
      rungId: (rung as RungState).id,
      node: {
        ...node,
        data: {
          ...node.data,
          variable: contactVariableValue,
        },
      },
      editorName: editor.meta.name,
    })
  }

  return (
    <div
      className={cn('relative', {
        'opacity-40': id.startsWith('copycat'),
      })}
    >
      <div
        className={cn(
          'rounded-[1px] border border-transparent hover:outline hover:outline-2 hover:outline-offset-[5px] hover:outline-brand',
          {
            'outline outline-2 outline-offset-[5px] outline-brand': selected,
          },
        )}
        style={{ width: DEFAULT_CONTACT_BLOCK_WIDTH, height: DEFAULT_CONTACT_BLOCK_HEIGHT }}
      >
        {contact.svg}
      </div>
      <div className='absolute -left-[34px] -top-7 w-24'>
        <InputWithRef
          value={contactVariableValue}
          onChange={(e) => setContactVariableValue(e.target.value)}
          placeholder='???'
          className='w-full bg-transparent text-center text-sm outline-none'
          onBlur={handleVariableInputOnBlur}
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
    },
    width: DEFAULT_CONTACT_BLOCK_WIDTH,
    height: DEFAULT_CONTACT_BLOCK_HEIGHT,
    measured: {
      width: DEFAULT_CONTACT_BLOCK_WIDTH,
      height: DEFAULT_CONTACT_BLOCK_HEIGHT
    },
    draggable: true,
    selectable: true,
    selected: false,
  }
}
