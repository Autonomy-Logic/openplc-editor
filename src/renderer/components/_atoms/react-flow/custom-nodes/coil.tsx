import { Pencil1Icon } from '@radix-ui/react-icons'
import {
  DefaultCoil,
  FallingEdgeCoil,
  NegatedCoil,
  ResetCoil,
  RisingEdgeCoil,
  SetCoil,
} from '@root/renderer/assets/icons/flow/Coil'
import { ProhibitedIcon } from '@root/renderer/assets/icons/interface/Prohibited'
import { TrashCanIcon } from '@root/renderer/assets/icons/interface/TrashCan'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn, generateNumericUUID } from '@root/utils'
import type { Node, NodeProps } from '@xyflow/react'
import { Position } from '@xyflow/react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import { buildHandle, CustomHandle } from './handle'
import { getPouVariablesRungNodeAndEdges } from './utils'
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
    svg: (wrongVariable: boolean) => ReactNode
  }
}
export const DEFAULT_COIL_TYPES: CoilType = {
  default: {
    svg: (wrongVariable) => (
      <DefaultCoil
        width={DEFAULT_COIL_BLOCK_WIDTH}
        height={DEFAULT_COIL_BLOCK_HEIGHT}
        parenthesesClassName={cn('fill-neutral-1000 dark:fill-neutral-100', {
          'fill-red-500 dark:fill-red-500': wrongVariable,
        })}
      />
    ),
  },
  negated: {
    svg: (wrongVariable) => (
      <NegatedCoil
        width={DEFAULT_COIL_BLOCK_WIDTH}
        height={DEFAULT_COIL_BLOCK_HEIGHT}
        parenthesesClassName={cn('fill-neutral-1000 dark:fill-neutral-100', {
          'fill-red-500 dark:fill-red-500': wrongVariable,
        })}
      />
    ),
  },
  risingEdge: {
    svg: (wrongVariable) => (
      <RisingEdgeCoil
        width={DEFAULT_COIL_BLOCK_WIDTH}
        height={DEFAULT_COIL_BLOCK_HEIGHT}
        parenthesesClassName={cn('fill-neutral-1000 dark:fill-neutral-100', {
          'fill-red-500 dark:fill-red-500': wrongVariable,
        })}
      />
    ),
  },
  fallingEdge: {
    svg: (wrongVariable) => (
      <FallingEdgeCoil
        width={DEFAULT_COIL_BLOCK_WIDTH}
        height={DEFAULT_COIL_BLOCK_HEIGHT}
        parenthesesClassName={cn('fill-neutral-1000 dark:fill-neutral-100', {
          'fill-red-500 dark:fill-red-500': wrongVariable,
        })}
      />
    ),
  },
  set: {
    svg: (wrongVariable) => (
      <SetCoil
        width={DEFAULT_COIL_BLOCK_WIDTH}
        height={DEFAULT_COIL_BLOCK_HEIGHT}
        parenthesesClassName={cn('fill-neutral-1000 dark:fill-neutral-100', {
          'fill-red-500 dark:fill-red-500': wrongVariable,
        })}
      />
    ),
  },
  reset: {
    svg: (wrongVariable) => (
      <ResetCoil
        width={DEFAULT_COIL_BLOCK_WIDTH}
        height={DEFAULT_COIL_BLOCK_HEIGHT}
        parenthesesClassName={cn('fill-neutral-1000 dark:fill-neutral-100', {
          'fill-red-500 dark:fill-red-500': wrongVariable,
        })}
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
    flows,
    flowActions: { removeNodes, updateNode, setSelectedNodes },
  } = useOpenPLCStore()

  const coil = DEFAULT_COIL_TYPES[data.variant]
  const [coilVariableValue, setCoilVariableValue] = useState<string>('')
  const [wrongVariable, setWrongVariable] = useState<boolean>(false)

  const inputVariableRef = useRef<HTMLTextAreaElement>(null)
  const scrollableIndicatorRef = useRef<HTMLDivElement>(null)
  const [inputFocus, setInputFocus] = useState<boolean>(true)

  useEffect(() => {
    if (inputVariableRef.current) {
      inputVariableRef.current.style.height = 'auto'
      inputVariableRef.current.style.height = `${inputVariableRef.current.scrollHeight < 32 ? inputVariableRef.current.scrollHeight : 32}px`
      if (scrollableIndicatorRef.current)
        scrollableIndicatorRef.current.style.display = inputVariableRef.current.scrollHeight > 32 ? 'block' : 'none'
    }
  }, [coilVariableValue])

  /**
   * useEffect to focus the variable input when the block is selected
   */
  useEffect(() => {
    if (data.variable && data.variable.name !== '') {
      setCoilVariableValue(data.variable.name)
      return
    }

    if (inputVariableRef.current) {
      inputVariableRef.current.focus()
    }
  }, [])

  /**
   * Update wrongVariable state when the table of variables is updated
   */
  useEffect(() => {
    const { variables, node, rung } = getPouVariablesRungNodeAndEdges(editor, pous, flows, {
      nodeId: id,
      variableName: coilVariableValue,
    })

    const variable = variables.selected
    if (!variable && !inputFocus) {
      setWrongVariable(true)
      return
    }

    if (variable && node && rung && node.data.variable !== variable) {
      setCoilVariableValue(variable.name)
      updateNode({
        editorName: editor.meta.name,
        rungId: rung.id,
        nodeId: node.id,
        node: {
          ...node,
          data: {
            ...node.data,
            variable,
          },
        },
      })
    }

    setWrongVariable(false)
  }, [pous])

  /**
   * Handle with the variable input onBlur event
   */
  const handleSubmitCoilVariable = () => {
    setInputFocus(false)

    const { variables, rung, node } = getPouVariablesRungNodeAndEdges(editor, pous, flows, {
      nodeId: id,
      variableName: coilVariableValue,
    })
    if (!rung || !node) return

    const variable = variables.selected
    if (!variable || variable.name !== coilVariableValue) {
      setWrongVariable(true)
      updateNode({
        editorName: editor.meta.name,
        rungId: rung.id,
        nodeId: node.id,
        node: {
          ...node,
          data: {
            ...node.data,
            variable: { name: coilVariableValue },
          },
        },
      })
      return
    }

    updateNode({
      editorName: editor.meta.name,
      rungId: rung.id,
      nodeId: node.id,
      node: {
        ...node,
        data: {
          ...node.data,
          variable: variable,
        },
      },
    })
    setWrongVariable(false)
  }

  const handleDeleteNode = () => {
    const { rung, node } = getPouVariablesRungNodeAndEdges(editor, pous, flows, {
      nodeId: id,
    })
    if (!rung || !node) return

    removeNodes({
      editorName: editor.meta.name,
      rungId: rung.id,
      nodes: [node],
    })
  }

  const handleDeselectNode = () => {
    const { rung, node } = getPouVariablesRungNodeAndEdges(editor, pous, flows, {
      nodeId: id,
    })
    if (!rung || !node) return

    setSelectedNodes({
      editorName: editor.meta.name,
      rungId: rung.id,
      nodes: (rung.selectedNodes || []).filter((selectedNode) => selectedNode.id !== node.id),
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
        {coil.svg(wrongVariable)}
      </div>
      <div className='absolute -left-[30px] -top-[38px] flex h-8 w-24 items-center justify-center'>
        <textarea
          value={coilVariableValue}
          onChange={(e) => setCoilVariableValue(e.target.value)}
          placeholder='???'
          className='w-full resize-none bg-transparent text-center text-xs outline-none [&::-webkit-scrollbar]:hidden'
          onFocus={() => setInputFocus(true)}
          onBlur={() => {
            if (inputVariableRef.current) inputVariableRef.current.scrollTop = 0
            inputFocus && handleSubmitCoilVariable()
          }}
          onKeyDown={(e) => e.key === 'Enter' && inputVariableRef.current?.blur()}
          ref={inputVariableRef}
          rows={1}
        />
      </div>
      <div className={cn('pointer-events-none absolute -right-[48px] -top-7 text-xs')} ref={scrollableIndicatorRef}>
        ↕
      </div>
      {selected && (
        <div className='absolute -bottom-7 -right-4 flex items-center justify-center gap-2'>
          <Pencil1Icon className='h-4 w-4 stroke-neutral-850 hover:stroke-neutral-50 dark:stroke-neutral-50 dark:hover:stroke-neutral-850' />
          <ProhibitedIcon
            className='h-4 w-4 stroke-neutral-850 hover:stroke-neutral-50 dark:stroke-neutral-50 dark:hover:stroke-neutral-850'
            onClick={handleDeselectNode}
          />
          <TrashCanIcon
            className='h-4 w-4 stroke-neutral-850 hover:stroke-neutral-50 dark:stroke-neutral-50 dark:hover:stroke-neutral-850'
            onClick={handleDeleteNode}
          />
        </div>
      )}
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
      variable: { name: '' },
      executionOrder: 0,
      draggable: true,
      selectable: true,
      deletable: true,
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
