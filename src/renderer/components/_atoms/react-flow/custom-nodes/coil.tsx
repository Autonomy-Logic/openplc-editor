import {
  DefaultCoil,
  FallingEdgeCoil,
  NegatedCoil,
  ResetCoil,
  RisingEdgeCoil,
  SetCoil,
} from '@root/renderer/assets/icons/flow/Coil'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn, generateNumericUUID } from '@root/utils'
import type { Node, NodeProps } from '@xyflow/react'
import { Position } from '@xyflow/react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import { HighlightedTextArea } from '../../highlighted-textarea'
import { buildHandle, CustomHandle } from './handle'
import { getPouVariablesRungNodeAndEdges } from './utils'
import type { BasicNodeData, BuilderBasicProps } from './utils/types'
import { VariablesBlockAutoComplete } from './variables-block-autocomplete'

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

export const Coil = (block: CoilProps) => {
  const { selected, data, id } = block

  const {
    editor,
    project: {
      data: { pous },
    },
    flows,
    flowActions: { updateNode },
  } = useOpenPLCStore()

  const coil = DEFAULT_COIL_TYPES[data.variant]
  const [coilVariableValue, setCoilVariableValue] = useState<string>(data.variable.name)
  const [wrongVariable, setWrongVariable] = useState<boolean>(false)

  const inputWrapperRef = useRef<HTMLDivElement>(null)
  const inputVariableRef = useRef<
    HTMLTextAreaElement & {
      blur: ({ submit }: { submit?: boolean }) => void
      isFocused: boolean
    }
  >(null)
  const autocompleteRef = useRef<
    HTMLDivElement & {
      focus: () => void
      isFocused: boolean
      selectedVariable: { positionInArray: number; variableName: string }
    }
  >(null)

  const [openAutocomplete, setOpenAutocomplete] = useState<boolean>(false)
  const [keyPressedAtTextarea, setKeyPressedAtTextarea] = useState<string>('')

  useEffect(() => {
    if (inputVariableRef.current && inputWrapperRef.current) {
      inputWrapperRef.current.style.top = inputVariableRef.current.scrollHeight >= 24 ? '-24px' : '-20px'
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

    if (!rung || !node) return

    const variable = variables.selected
    if (!variable) {
      setWrongVariable(true)
      return
    }

    if (variable && (variable.type.definition !== 'base-type' || variable.type.value.toUpperCase() !== 'BOOL')) {
      setWrongVariable(true)
      return
    }

    if ((node.data as BasicNodeData).variable.id !== variable.id) {
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
      setWrongVariable(false)
      return
    }

    if ((node.data as BasicNodeData).variable.id === variable.id && variable.name !== coilVariableValue) {
      if ((node.data as BasicNodeData).variable.name !== variable.name) {
        updateNode({
          editorName: editor.meta.name,
          rungId: rung.id,
          nodeId: node.id,
          node: {
            ...node,
            data: {
              ...node.data,
              variable: {
                ...variable,
                name: variable.name,
              },
            },
          },
        })
      }
      setCoilVariableValue(variable.name)
      setWrongVariable(false)
      return
    }

    setWrongVariable(false)
  }, [pous])

  /**
   * Handle with the variable input onBlur event
   */
  const handleSubmitCoilVariableOnTextareaBlur = (variableName?: string) => {
    const variableNameToSubmit = variableName || coilVariableValue
    const { variables, rung, node } = getPouVariablesRungNodeAndEdges(editor, pous, flows, {
      nodeId: id,
      variableName: variableNameToSubmit,
    })
    if (!rung || !node) return

    const variable = variables.selected
    if (
      !variable ||
      variable.name !== variableNameToSubmit ||
      variable.type.definition !== 'base-type' ||
      variable.type.value.toUpperCase() !== 'BOOL'
    ) {
      updateNode({
        editorName: editor.meta.name,
        rungId: rung.id,
        nodeId: node.id,
        node: {
          ...node,
          data: {
            ...node.data,
            variable: { name: variableNameToSubmit },
          },
        },
      })
      setWrongVariable(true)
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

  const onChangeHandler = () => {
    if (!openAutocomplete) {
      setOpenAutocomplete(true)
    }
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
        {coil.svg(wrongVariable)}
        <div className='absolute left-1/2 w-[72px] -translate-x-1/2' ref={inputWrapperRef}>
          <HighlightedTextArea
            textAreaValue={coilVariableValue}
            setTextAreaValue={setCoilVariableValue}
            handleSubmit={handleSubmitCoilVariableOnTextareaBlur}
            inputHeight={{
              height: 24,
              scrollLimiter: 32,
            }}
            ref={inputVariableRef}
            textAreaClassName='text-center text-xs leading-3'
            highlightClassName='text-center text-xs leading-3'
            onFocus={() => {
              const { node, rung } = getPouVariablesRungNodeAndEdges(editor, pous, flows, {
                nodeId: id ?? '',
              })
              if (!node || !rung) return
              updateNode({
                editorName: editor.meta.name,
                nodeId: node.id,
                rungId: rung.id,
                node: {
                  ...node,
                  draggable: false,
                },
              })
              return
            }}
            onBlur={() => {
              const { node, rung } = getPouVariablesRungNodeAndEdges(editor, pous, flows, {
                nodeId: id ?? '',
              })
              if (!node || !rung) return
              updateNode({
                editorName: editor.meta.name,
                nodeId: node.id,
                rungId: rung.id,
                node: {
                  ...node,
                  draggable: node.data.draggable as boolean,
                },
              })
              return
            }}
            onChange={onChangeHandler}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab') e.preventDefault()
              if (e.key === 'Enter' && autocompleteRef.current?.selectedVariable.positionInArray !== -1) {
                inputVariableRef.current?.blur({ submit: false })
              }
              setKeyPressedAtTextarea(e.key)
            }}
            onKeyUp={() => setKeyPressedAtTextarea('')}
          />
          {openAutocomplete && (
            <div className='relative flex justify-center'>
              <div className='absolute -bottom-4'>
                <VariablesBlockAutoComplete
                  ref={autocompleteRef}
                  block={block}
                  blockType={'coil'}
                  valueToSearch={coilVariableValue}
                  isOpen={openAutocomplete}
                  setIsOpen={(value) => setOpenAutocomplete(value)}
                  keyPressed={keyPressedAtTextarea}
                />
              </div>
            </div>
          )}
        </div>
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
