import { useOpenPLCStore } from '@root/renderer/store'
import type { RungState } from '@root/renderer/store/slices'
import type { PLCVariable } from '@root/types/PLC'
import { cn, generateNumericUUID } from '@root/utils'
import { Node, NodeProps, Position } from '@xyflow/react'
import { useState } from 'react'

import { InputWithRef } from '../../input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../tooltip'
import { buildHandle, CustomHandle } from './handle'
import type { BasicNodeData, BuilderBasicProps } from './utils/types'

export type BlockVariant = {
  name: string
  variables: { name: string; class: string; type: { definition: string; value: string } }[]
  documentation: string
}
export type BlockNodeData<T> = BasicNodeData & { variant: T }
export type BlockNode<T> = Node<BlockNodeData<T>>
type BlockProps<T> = NodeProps<BlockNode<T>>
type BlockBuilderProps<T> = BuilderBasicProps & { variant: T }

export const DEFAULT_BLOCK_WIDTH = 216
export const DEFAULT_BLOCK_HEIGHT = 128

export const DEFAULT_BLOCK_CONNECTOR_X = DEFAULT_BLOCK_WIDTH
export const DEFAULT_BLOCK_CONNECTOR_Y = 40
export const DEFAULT_BLOCK_CONNECTOR_Y_OFFSET = 32

export const DEFAULT_BLOCK_TYPE = {
  name: '???',
  variables: [
    { name: '???', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
    { name: '???', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
  ],
  documentation: `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nullam aliquam tristique tincidunt. Duis elementum
            tortor sem, non convallis orci facilisis at. Suspendisse id bibendum nisl. Mauris ac massa diam. Mauris
            ultrices massa justo, sed vehicula tellus rhoncus eget. Suspendisse lacinia nec dolor vitae sollicitudin.
            Interdum et malesuada fames ac ante ipsum primis in faucibus. Quisque rutrum, tellus eu maximus cursus,
            metus urna eleifend ex, vitae accumsan nisl neque luctus diam. Quisque vel dui vel eros lobortis maximus non
            eget mauris. Aenean aliquet, justo id tempor placerat, ipsum purus molestie justo, sed euismod est arcu
            fermentum odio. Nullam et mauris leo. Aenean magna ex, sollicitudin at consequat non, cursus nec elit. Morbi
            sodales porta elementum.`,
}

export const BlockNodeElement = <T extends object>({
  data,
  disabled = false,
  height,
  selected,
  scale = 1,
  blockNameValue,
  setBlockNameValue,
}: {
  data: BlockNodeData<T>
  height: number
  selected: boolean
  disabled?: boolean
  scale?: number
  blockNameValue?: string
  setBlockNameValue?: (value: string) => void
}) => {
  const { name, variables } = (data.variant as BlockVariant) ?? DEFAULT_BLOCK_TYPE

  const inputConnectors = variables.filter((variable) => variable.class === 'input').map((variable) => variable.name)
  const outputConnectors = variables.filter((variable) => variable.class === 'output').map((variable) => variable.name)

  return (
    <div
      className={cn(
        'relative flex flex-col rounded-md border border-neutral-850 bg-white text-neutral-1000 dark:bg-neutral-900 dark:text-neutral-50',
        {
          'hover:border-transparent hover:ring-2 hover:ring-brand': !disabled,
          'border-transparent ring-2 ring-brand': selected,
        },
      )}
      style={{
        width: DEFAULT_BLOCK_WIDTH,
        height: height,
        transform: `scale(${scale})`,
      }}
    >
      <InputWithRef
        value={blockNameValue ?? name}
        onChange={(e) => setBlockNameValue && setBlockNameValue(e.target.value)}
        maxLength={20}
        placeholder='???'
        className='w-full bg-transparent p-1 text-center text-sm outline-none'
        disabled={!setBlockNameValue}
      />
      {inputConnectors.map((connector, index) => (
        <div
          key={index}
          className='absolute text-sm'
          style={{ top: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET - 11, left: 7 }}
        >
          {connector}
        </div>
      ))}
      {outputConnectors.map((connector, index) => (
        <div
          key={index}
          className='absolute text-sm'
          style={{ top: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET - 11, right: 7 }}
        >
          {connector}
        </div>
      ))}
    </div>
  )
}

export const Block = <T extends object>({ data, dragging, height, selected, id }: BlockProps<T>) => {
  const {
    editor,
    project: {
      data: { pous },
    },
    flowActions: { updateNode },
  } = useOpenPLCStore()

  const { name, documentation } = (data.variant as BlockVariant) ?? DEFAULT_BLOCK_TYPE

  const [blockVariableValue, setBlockVariableValue] = useState<string>('')
  const [blockNameValue, setBlockNameValue] = useState<string>(name)

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

    if (!variables.some((variable) => variable.name === blockVariableValue)) return
    if (!rung) return

    node = (rung as RungState).nodes.find((node) => node.id === id)
    if (!node) return

    updateNode({
      rungId: (rung as RungState).id,
      node: {
        ...node,
        data: {
          ...node.data,
          variable: blockVariableValue,
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
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <BlockNodeElement
              data={data}
              height={height ?? DEFAULT_BLOCK_HEIGHT}
              selected={selected ?? false}
              blockNameValue={blockNameValue}
              setBlockNameValue={setBlockNameValue}
            />
          </TooltipTrigger>
          {!dragging && <TooltipContent side='right'>{documentation}</TooltipContent>}
        </Tooltip>
      </TooltipProvider>
      <div
        className='absolute -top-7'
        style={{
          width: DEFAULT_BLOCK_WIDTH,
        }}
      >
        <InputWithRef
          value={blockVariableValue}
          onChange={(e) => setBlockVariableValue(e.target.value)}
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
}: BlockBuilderProps<T>) => {
  const type = (variant as BlockVariant) ?? DEFAULT_BLOCK_TYPE
  const inputConnectors = type.variables
    .filter((variable) => variable.class === 'input')
    .map((variable) => variable.name)
  const outputConnectors = type.variables
    .filter((variable) => variable.class === 'output')
    .map((variable) => variable.name)

  const leftHandles = inputConnectors.map((connector, index) =>
    buildHandle({
      id: `${connector}`,
      position: Position.Left,
      type: 'target',
      isConnectable: false,
      glbX: handleX,
      glbY: handleY + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
      relX: 0,
      relY: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
      style: {
        top: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
        left: 0,
      },
    }),
  )

  const rightHandles = outputConnectors.map((connector, index) =>
    buildHandle({
      id: `${connector}`,
      position: Position.Right,
      type: 'source',
      isConnectable: false,
      glbX: handleX + DEFAULT_BLOCK_CONNECTOR_X,
      glbY: handleY + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
      relX: DEFAULT_BLOCK_CONNECTOR_X,
      relY: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
      style: {
        top: DEFAULT_BLOCK_CONNECTOR_Y + index * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
        right: 0,
      },
    }),
  )

  const handles = [...leftHandles, ...rightHandles]

  const blocKHeight =
    DEFAULT_BLOCK_CONNECTOR_Y +
    Math.max(inputConnectors.length, outputConnectors.length) * DEFAULT_BLOCK_CONNECTOR_Y_OFFSET

  return {
    id,
    type: 'block',
    position: { x: posX, y: posY },
    data: {
      variant: variant ?? DEFAULT_BLOCK_TYPE,
      handles,
      inputHandles: leftHandles,
      outputHandles: rightHandles,
      inputConnector: leftHandles[0],
      outputConnector: rightHandles[0],
      numericId: generateNumericUUID(),
      variable: '',
    },
    width: DEFAULT_BLOCK_WIDTH,
    height: DEFAULT_BLOCK_HEIGHT < blocKHeight ? blocKHeight : DEFAULT_BLOCK_HEIGHT,
    measured: {
      width: DEFAULT_BLOCK_WIDTH,
      height: DEFAULT_BLOCK_HEIGHT < blocKHeight ? blocKHeight : DEFAULT_BLOCK_HEIGHT,
    },
    draggable: true,
    selectable: true,
    selected: false,
  }
}
