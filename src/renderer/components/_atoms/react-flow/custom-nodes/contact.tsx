import {
  DefaultContact,
  FallingEdgeContact,
  NegatedContact,
  RisingEdgeContact,
} from '@root/renderer/assets/icons/flow/Contact'
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

export type ContactNode = Node<BasicNodeData & { variant: 'default' | 'negated' | 'risingEdge' | 'fallingEdge' }>
type ContactProps = NodeProps<ContactNode>
type ContactBuilderProps = BuilderBasicProps & { variant: 'default' | 'negated' | 'risingEdge' | 'fallingEdge' }

export const DEFAULT_CONTACT_BLOCK_WIDTH = 24
export const DEFAULT_CONTACT_BLOCK_HEIGHT = 24

export const DEFAULT_CONTACT_CONNECTOR_X = DEFAULT_CONTACT_BLOCK_WIDTH
export const DEFAULT_CONTACT_CONNECTOR_Y = DEFAULT_CONTACT_BLOCK_HEIGHT / 2

type ContactType = {
  [key in ContactNode['data']['variant']]: {
    svg: (wrongVariable: boolean) => ReactNode
  }
}
export const DEFAULT_CONTACT_TYPES: ContactType = {
  default: {
    svg: (wrongVariable): ReactNode => (
      <DefaultContact
        width={DEFAULT_CONTACT_BLOCK_WIDTH}
        height={DEFAULT_CONTACT_BLOCK_HEIGHT}
        strokeClassName={cn('stroke-neutral-1000 dark:stroke-neutral-100', {
          'stroke-red-500 dark:stroke-red-500': wrongVariable,
        })}
      />
    ),
  },
  negated: {
    svg: (wrongVariable): ReactNode => (
      <NegatedContact
        width={DEFAULT_CONTACT_BLOCK_WIDTH}
        height={DEFAULT_CONTACT_BLOCK_HEIGHT}
        strokeClassName={cn('stroke-neutral-1000 dark:stroke-neutral-100', {
          'stroke-red-500 dark:stroke-red-500': wrongVariable,
        })}
      />
    ),
  },
  risingEdge: {
    svg: (wrongVariable): ReactNode => (
      <RisingEdgeContact
        width={DEFAULT_CONTACT_BLOCK_WIDTH}
        height={DEFAULT_CONTACT_BLOCK_HEIGHT}
        strokeClassName={cn('stroke-neutral-1000 dark:stroke-neutral-100', {
          'stroke-red-500 dark:stroke-red-500': wrongVariable,
        })}
      />
    ),
  },
  fallingEdge: {
    svg: (wrongVariable): ReactNode => (
      <FallingEdgeContact
        width={DEFAULT_CONTACT_BLOCK_WIDTH}
        height={DEFAULT_CONTACT_BLOCK_HEIGHT}
        strokeClassName={cn('stroke-neutral-1000 dark:stroke-neutral-100', {
          'stroke-red-500 dark:stroke-red-500': wrongVariable,
        })}
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
    flows,
    flowActions: { updateNode },
    searchQuery,
  } = useOpenPLCStore()

  const contact = DEFAULT_CONTACT_TYPES[data.variant]
  const [contactVariableValue, setContactVariableValue] = useState<string>('')
  const [wrongVariable, setWrongVariable] = useState<boolean>(false)

  const inputWrapperRef = useRef<HTMLDivElement>(null)
  const inputVariableRef = useRef<HTMLTextAreaElement>(null)
  const scrollableIndicatorRef = useRef<HTMLDivElement>(null)
  const [inputFocus, setInputFocus] = useState<boolean>(true)

  const highlightDivRef = useRef<HTMLDivElement>(null)
  const [scrollValue, setScrollValue] = useState<number>(0)
  const formattedContactVariableValue = searchQuery
    ? extractSearchQuery(contactVariableValue, searchQuery)
    : contactVariableValue

  useEffect(() => {
    if (inputVariableRef.current && highlightDivRef.current && inputWrapperRef.current) {
      // height
      inputVariableRef.current.style.height = 'auto'
      inputVariableRef.current.style.height = `${inputVariableRef.current.scrollHeight < 32 ? inputVariableRef.current.scrollHeight : 24}px`
      highlightDivRef.current.style.height = 'auto'
      highlightDivRef.current.style.height = inputVariableRef.current.style.height
      // top
      inputWrapperRef.current.style.top = inputVariableRef.current.scrollHeight >= 24 ? '-32px' : '-16px'
      // scrollable indicator
      if (scrollableIndicatorRef.current) {
        scrollableIndicatorRef.current.style.display = inputVariableRef.current.scrollHeight > 32 ? 'block' : 'none'
      }
    }
  }, [contactVariableValue])

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
      setContactVariableValue(data.variable.name)
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
      variableName: contactVariableValue,
    })

    const variable = variables.selected
    if (!variable && !inputFocus) {
      setWrongVariable(true)
      return
    }
    if (variable && (variable.type.definition !== 'base-type' || variable.type.value.toUpperCase() !== 'BOOL')) {
      setWrongVariable(true)
      return
    }
    if (variable && node && rung && node.data.variable !== variable) {
      setContactVariableValue(variable.name)
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
  const handleSubmitContactVariable = () => {
    setInputFocus(false)

    const { rung, node, variables } = getPouVariablesRungNodeAndEdges(editor, pous, flows, {
      nodeId: id,
      variableName: contactVariableValue,
    })
    if (!rung || !node) return

    const variable = variables.selected
    if (
      !variable ||
      variable.name !== contactVariableValue ||
      variable.type.definition !== 'base-type' ||
      variable.type.value.toUpperCase() !== 'BOOL'
    ) {
      setWrongVariable(true)
      updateNode({
        editorName: editor.meta.name,
        rungId: rung.id,
        nodeId: node.id,
        node: {
          ...node,
          data: {
            ...node.data,
            variable: { name: contactVariableValue },
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
          variable,
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
        style={{ width: DEFAULT_CONTACT_BLOCK_WIDTH, height: DEFAULT_CONTACT_BLOCK_HEIGHT }}
      >
        {contact.svg(wrongVariable)}
        <div className='absolute -left-[24px] -top-[16px] w-[72px]' ref={inputWrapperRef}>
          <div className='relative w-full'>
            <div
              className='-z-1 pointer-events-none absolute w-full overflow-y-scroll [&::-webkit-scrollbar]:hidden'
              ref={highlightDivRef}
            >
              <div
                className='w-full whitespace-pre-wrap break-words text-center text-xs leading-3 text-transparent'
                dangerouslySetInnerHTML={{ __html: formattedContactVariableValue }}
              />
            </div>
            <textarea
              value={contactVariableValue}
              onChange={(e) => setContactVariableValue(e.target.value)}
              placeholder='???'
              className='absolute w-full resize-none bg-transparent text-center text-xs leading-3 outline-none [&::-webkit-scrollbar]:hidden'
              onFocus={() => setInputFocus(true)}
              onBlur={() => {
                if (inputVariableRef.current && highlightDivRef.current) {
                  inputVariableRef.current.scrollTop = 0
                  highlightDivRef.current.scrollTop = 0
                }
                inputFocus && handleSubmitContactVariable()
              }}
              onScroll={(e) => onScrollHandler(e)}
              onKeyDown={(e) => e.key === 'Enter' && inputVariableRef.current?.blur()}
              ref={inputVariableRef}
              rows={1}
              spellCheck={false}
            />
          </div>
          <div className={cn('pointer-events-none absolute -right-1 top-1 text-cp-sm')} ref={scrollableIndicatorRef}>
            ↕
          </div>
        </div>
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
      variable: { name: '' },
      executionOrder: 0,
      draggable: true,
      selectable: true,
      deletable: true,
    },
    width: DEFAULT_CONTACT_BLOCK_WIDTH,
    height: DEFAULT_CONTACT_BLOCK_HEIGHT,
    measured: {
      width: DEFAULT_CONTACT_BLOCK_WIDTH,
      height: DEFAULT_CONTACT_BLOCK_HEIGHT,
    },
    draggable: true,
    selectable: true,
    selected: true,
  }
}
