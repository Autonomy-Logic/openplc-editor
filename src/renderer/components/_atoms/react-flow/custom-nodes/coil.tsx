import {
  DefaultCoil,
  FallingEdgeCoil,
  NegatedCoil,
  ResetCoil,
  RisingEdgeCoil,
  SetCoil,
} from '@root/renderer/assets/icons/flow/Coil'
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

export type CoilNode = Node<
  BasicNodeData & {
    variant: 'default' | 'negated' | 'risingEdge' | 'fallingEdge' | 'set' | 'reset'
  }
>
type CoilProps = NodeProps<CoilNode>
type CoilBuilderProps = BuilderBasicProps & {
  variant: 'default' | 'negated' | 'risingEdge' | 'fallingEdge' | 'set' | 'reset'
}

export const DEFAULT_COIL_BLOCK_WIDTH = 34
export const DEFAULT_COIL_BLOCK_HEIGHT = 28

export const DEFAULT_COIL_CONNECTOR_X = DEFAULT_COIL_BLOCK_WIDTH
export const DEFAULT_COIL_CONNECTOR_Y = DEFAULT_COIL_BLOCK_HEIGHT / 2

type CoilType = {
  [key in CoilNode['data']['variant']]: {
    svg: ReactNode
  }
}
export const DEFAULT_COIL_TYPES: CoilType = {
  default: {
    svg: (
      <DefaultCoil
        width={DEFAULT_COIL_BLOCK_WIDTH}
        height={DEFAULT_COIL_BLOCK_HEIGHT}
        parenthesesClassName='fill-neutral-1000 dark:fill-neutral-100'
      />
    ),
  },
  negated: {
    svg: (
      <NegatedCoil
        width={DEFAULT_COIL_BLOCK_WIDTH}
        height={DEFAULT_COIL_BLOCK_HEIGHT}
        parenthesesClassName='fill-neutral-1000 dark:fill-neutral-100'
      />
    ),
  },
  risingEdge: {
    svg: (
      <RisingEdgeCoil
        width={DEFAULT_COIL_BLOCK_WIDTH}
        height={DEFAULT_COIL_BLOCK_HEIGHT}
        parenthesesClassName='fill-neutral-1000 dark:fill-neutral-100'
      />
    ),
  },
  fallingEdge: {
    svg: (
      <FallingEdgeCoil
        width={DEFAULT_COIL_BLOCK_WIDTH}
        height={DEFAULT_COIL_BLOCK_HEIGHT}
        parenthesesClassName='fill-neutral-1000 dark:fill-neutral-100'
      />
    ),
  },
  set: {
    svg: (
      <SetCoil
        width={DEFAULT_COIL_BLOCK_WIDTH}
        height={DEFAULT_COIL_BLOCK_HEIGHT}
        parenthesesClassName='fill-neutral-1000 dark:fill-neutral-100'
      />
    ),
  },
  reset: {
    svg: (
      <ResetCoil
        width={DEFAULT_COIL_BLOCK_WIDTH}
        height={DEFAULT_COIL_BLOCK_HEIGHT}
        parenthesesClassName='fill-neutral-1000 dark:fill-neutral-100'
      />
    ),
  },
}

export const Coil = ({ selected, data, id }: CoilProps) => {
  const {
    editor,
    project: {
      data: { pous },
    },
    flowActions: { updateNode },
  } = useOpenPLCStore()

  const [coilVariableValue, setCoilVariableValue] = useState<string>('')
  const coil = DEFAULT_COIL_TYPES[data.variant]

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

    if (!variables.some((variable) => variable.name === coilVariableValue)) return
    if (!rung) return

    node = (rung as RungState).nodes.find((node) => node.id === id)
    if (!node) return

    updateNode({
      rungId: (rung as RungState).id,
      node: {
        ...node,
        data: {
          ...node.data,
          variable: coilVariableValue,
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
        style={{ width: DEFAULT_COIL_BLOCK_WIDTH, height: DEFAULT_COIL_BLOCK_HEIGHT }}
      >
        {coil.svg}
      </div>
      <div className='absolute -left-[31px] -top-7 w-24'>
        <InputWithRef
          value={coilVariableValue}
          onChange={(e) => setCoilVariableValue(e.target.value)}
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
    },
    width: DEFAULT_COIL_BLOCK_WIDTH,
    height: DEFAULT_COIL_BLOCK_HEIGHT,
    measured: {
      width: DEFAULT_COIL_BLOCK_WIDTH,
      height: DEFAULT_COIL_BLOCK_HEIGHT,
    },
    draggable: true,
    selectable: true,
    selected: false,
  }
}
