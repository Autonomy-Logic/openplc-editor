import {
  DefaultContact,
  FallingEdgeContact,
  NegatedContact,
  RisingEdgeContact,
} from '@root/renderer/assets/icons/flow/Contact'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn, generateNumericUUID } from '@root/utils'
import type { Node, NodeProps } from '@xyflow/react'
import { Position } from '@xyflow/react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import { buildHandle, CustomHandle } from './handle'
import { getPouVariablesRungNodeAndEdges } from './utils'
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
    searchActions: { extractSearchQuery },
    searchQuery,
  } = useOpenPLCStore()

  const contact = DEFAULT_CONTACT_TYPES[data.variant]
  const [contactVariableValue, setContactVariableValue] = useState<string>('')
  const [wrongVariable, setWrongVariable] = useState<boolean>(false)

  const inputVariableRef = useRef<HTMLTextAreaElement>(null)
  const scrollableIndicatorRef = useRef<HTMLDivElement>(null)
  const [inputFocus, setInputFocus] = useState<boolean>(true)

  const [isEditing, setIsEditing] = useState<boolean>(false)

  const formattedContactVariableValue = searchQuery
    ? extractSearchQuery(contactVariableValue, searchQuery)
    : contactVariableValue

  useEffect(() => {
    if (inputVariableRef.current) {
      inputVariableRef.current.style.height = 'auto'
      inputVariableRef.current.style.height = `${inputVariableRef.current.scrollHeight < 32 ? inputVariableRef.current.scrollHeight : 32}px`
      if (scrollableIndicatorRef.current)
        scrollableIndicatorRef.current.style.display = inputVariableRef.current.scrollHeight > 32 ? 'block' : 'none'
    }
  }, [contactVariableValue])

  useEffect(() => {
    if (inputVariableRef.current) {
      inputVariableRef.current.style.height = 'auto'
      inputVariableRef.current.style.height = `${inputVariableRef.current.scrollHeight < 32 ? inputVariableRef.current.scrollHeight : 32}px`
      if (scrollableIndicatorRef.current)
        scrollableIndicatorRef.current.style.display = inputVariableRef.current.scrollHeight > 32 ? 'block' : 'none'
    }
  }, [contactVariableValue])

  /**
   * useEffect to focus the variable input when the block is selected
   */
  useEffect(() => {
    if (data.variable && data.variable.name !== '') {
      setContactVariableValue(data.variable.name)
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
    setIsEditing(false)
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
        {contact.svg(wrongVariable)}
      </div>
      <div className='absolute -left-[34px] -top-[38px] flex h-8 w-24 items-center justify-center'>
        {isEditing ? (
          <textarea
            value={contactVariableValue}
            onChange={(e) => setContactVariableValue(e.target.value)}
            placeholder='???'
            className='w-full resize-none bg-transparent text-center text-xs outline-none [&::-webkit-scrollbar]:hidden'
            onFocus={() => setInputFocus(true)}
            onBlur={() => {
              if (inputVariableRef.current) inputVariableRef.current.scrollTop = 0
              inputFocus && handleSubmitContactVariable()
            }}
            onKeyDown={(e) => e.key === 'Enter' && inputVariableRef.current?.blur()}
            ref={inputVariableRef}
            rows={1}
          />
        ) : (
          <p
            onClick={() => setIsEditing(true)}
            className='w-full resize-none bg-transparent text-center text-xs outline-none [&::-webkit-scrollbar]:hidden'
            dangerouslySetInnerHTML={{ __html: formattedContactVariableValue || '???' }}
          />
        )}
      </div>
      <div className={cn('pointer-events-none absolute -right-[48px] -top-7 text-xs')} ref={scrollableIndicatorRef}>
        ↕
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
    selected: false,
  }
}
