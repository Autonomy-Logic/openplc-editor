import {
  DefaultCoil,
  FallingEdgeCoil,
  NegatedCoil,
  ResetCoil,
  RisingEdgeCoil,
  SetCoil,
} from '@root/renderer/assets/icons/flow/Coil'
import { useOpenPLCStore } from '@root/renderer/store'
import { extractSearchQuery } from '@root/renderer/store/slices/search/utils'
import { cn, generateNumericUUID } from '@root/utils'
import type { Node, NodeProps } from '@xyflow/react'
import { Position } from '@xyflow/react'
import type { ReactNode, UIEvent } from 'react'
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

export const DEFAULT_COIL_BLOCK_WIDTH = 28
export const DEFAULT_COIL_BLOCK_HEIGHT = 24

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
    flowActions: { updateNode },
    searchQuery,
  } = useOpenPLCStore()

  const coil = DEFAULT_COIL_TYPES[data.variant]
  const [coilVariableValue, setCoilVariableValue] = useState<string>('')
  const [wrongVariable, setWrongVariable] = useState<boolean>(false)

  const inputWrapperRef = useRef<HTMLDivElement>(null)
  const inputVariableRef = useRef<HTMLTextAreaElement>(null)
  const scrollableIndicatorRef = useRef<HTMLDivElement>(null)
  const [inputFocus, setInputFocus] = useState<boolean>(true)

  const highlightDivRef = useRef<HTMLDivElement>(null)
  const [scrollValue, setScrollValue] = useState<number>(0)
  const formattedCoilVariableValue = searchQuery
    ? extractSearchQuery(coilVariableValue, searchQuery)
    : coilVariableValue

  useEffect(() => {
    if (inputVariableRef.current && highlightDivRef.current && inputWrapperRef.current) {
      // height
      inputVariableRef.current.style.height = 'auto'
      inputVariableRef.current.style.height = `${inputVariableRef.current.scrollHeight < 32 ? inputVariableRef.current.scrollHeight : 24}px`
      highlightDivRef.current.style.height = 'auto'
      highlightDivRef.current.style.height = inputVariableRef.current.style.height
      // top
      highlightDivRef.current.style.top = inputVariableRef.current.scrollHeight >= 24 ? '-30px' : '-24px'
      inputWrapperRef.current.style.top = inputVariableRef.current.scrollHeight >= 24 ? '-30px' : '-24px'
      // scrollable indicator
      if (scrollableIndicatorRef.current) {
        scrollableIndicatorRef.current.style.display = inputVariableRef.current.scrollHeight > 32 ? 'block' : 'none'
      }
    }
  }, [coilVariableValue])

  useEffect(() => {
    if (highlightDivRef.current) {
      highlightDivRef.current.scrollTop = scrollValue
    }
  }, [scrollValue])

  /**
   * useEffect to focus the variable input when the block is selected
   */
  useEffect(() => {
    if (data.variable && data.variable.name !== '') {
      setCoilVariableValue(data.variable.name)
      return
    }

    if (inputVariableRef.current && selected) {
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

  const onScrollHandler = (e: UIEvent<HTMLTextAreaElement>) => {
    setScrollValue(e.currentTarget.scrollTop)
  }

  return (
    <div
      className={cn({
        'opacity-40': id.startsWith('copycat'),
      })}
    >
      <div
        className={cn(
          'relative rounded-[1px] border border-transparent hover:outline hover:outline-2 hover:outline-offset-[3px] hover:outline-brand',
          {
            'outline outline-2 outline-offset-[3px] outline-brand': selected,
          },
        )}
        style={{ width: DEFAULT_COIL_BLOCK_WIDTH, height: DEFAULT_COIL_BLOCK_HEIGHT }}
      >
        <div
          className='-z-1 pointer-events-none absolute -left-[24px] -top-[24px] w-[72px] overflow-y-scroll [&::-webkit-scrollbar]:hidden'
          ref={highlightDivRef}
        >
          <div
            className='h-full w-full whitespace-pre-wrap break-words text-center text-xs leading-3 text-transparent'
            dangerouslySetInnerHTML={{ __html: formattedCoilVariableValue }}
          />
        </div>
        <div className='absolute -left-[24px] -top-[24px] w-[72px]' ref={inputWrapperRef}>
          <textarea
            value={coilVariableValue}
            onChange={(e) => setCoilVariableValue(e.target.value)}
            placeholder='???'
            className='w-full resize-none bg-transparent text-center text-xs leading-3 outline-none [&::-webkit-scrollbar]:hidden'
            onFocus={() => setInputFocus(true)}
            onBlur={() => {
              if (inputVariableRef.current && highlightDivRef.current) {
                inputVariableRef.current.scrollTop = 0
                highlightDivRef.current.scrollTop = 0
              }
              inputFocus && handleSubmitCoilVariable()
            }}
            onScroll={(e) => onScrollHandler(e)}
            onKeyDown={(e) => e.key === 'Enter' && inputVariableRef.current?.blur()}
            ref={inputVariableRef}
            rows={1}
            spellCheck={false}
          />
        </div>
        <div
          className={cn('pointer-events-none absolute -right-[38px] -top-[27px] text-cp-sm')}
          ref={scrollableIndicatorRef}
        >
          ↕
        </div>
        {coil.svg(wrongVariable)}
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
    selected: true,
  }
}
