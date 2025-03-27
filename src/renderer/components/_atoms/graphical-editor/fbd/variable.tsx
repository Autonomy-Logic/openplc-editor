import { useOpenPLCStore } from '@root/renderer/store'
import { PLCVariable } from '@root/types/PLC'
import { cn, generateNumericUUID } from '@root/utils'
import { Node, NodeProps, Position } from '@xyflow/react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { HighlightedTextArea } from '../../highlighted-textarea'
import { BlockVariant } from '../types/block'
import { getVariableByName, validateVariableType } from '../utils'
import { BlockNode } from './block'
import { buildHandle, CustomHandle } from './handle'
import { BasicNodeData, BuilderBasicProps } from './utils/types'
import { getFBDPouVariablesRungNodeAndEdges } from './utils/utils'

export type VariableNode = Node<
  BasicNodeData & {
    variant: 'input-variable' | 'output-variable' | 'inout-variable'
    negated: boolean
  }
>
type VariableProps = NodeProps<VariableNode>
type VariableBuilderProps = BuilderBasicProps & {
  variant: 'input-variable' | 'output-variable' | 'inout-variable'
}

export const DEFAULT_VARIABLE_WIDTH = 80
export const DEFAULT_VARIABLE_HEIGHT = 32

export const ELEMENT_SIZE = 128
export const ELEMENT_HEIGHT = 32

export const DEFAULT_VARIABLE_CONNECTOR_X = DEFAULT_VARIABLE_WIDTH
export const DEFAULT_VARIABLE_CONNECTOR_Y = DEFAULT_VARIABLE_HEIGHT / 2

const VariableElement = (block: VariableProps) => {
  const { id, data, selected } = block
  const {
    editor,
    editorActions: { updateModelFBD },
    fbdFlows,
    fbdFlowActions: { updateNode },
    project: {
      data: { pous, dataTypes },
    },
  } = useOpenPLCStore()

  const inputVariableRef = useRef<
    HTMLTextAreaElement & {
      blur: ({ submit }: { submit?: boolean }) => void
      isFocused: boolean
    }
  >(null)

  const [openAutocomplete, setOpenAutocomplete] = useState<boolean>(false)
  const [_keyPressedAtTextarea, setKeyPressedAtTextarea] = useState<string>('')

  const [variableValue, setVariableValue] = useState('')
  const [inputError, setInputError] = useState<boolean>(false)
  const [isAVariable, setIsAVariable] = useState<boolean>(false)

  /**
   * Get the connection type
   */
  const flow = useMemo(() => fbdFlows.find((flow) => flow.name === editor.meta.name), [fbdFlows, editor])
  const connection = useMemo(() => {
    const rung = flow?.rung
    if (!rung)
      return {
        node: undefined,
        edge: undefined,
      }

    const sourceEdge = rung.edges.find((edge) => edge.source === id)
    const targetNode = rung.nodes.find((block) => block.id === sourceEdge?.target && block.type === 'block')

    const targetEdge = rung.edges.find((edge) => edge.target === id)
    const sourceNode = rung.nodes.find((block) => block.id === targetEdge?.source && block.type === 'block')

    const connectedBlock = sourceNode || targetNode
    return {
      node: connectedBlock ? (connectedBlock as BlockNode<BlockVariant>) : undefined,
      targetEdge: targetEdge,
      sourceEdge: sourceEdge,
    }
  }, [flow])
  const connectionType = useMemo(() => {
    const variable = connection.node?.data.variant.variables.find(
      (variable) =>
        variable.name === connection.sourceEdge?.targetHandle || variable.name === connection.targetEdge?.sourceHandle,
    )
    return variable
      ? {
          string: `(*${variable.type.value}*)`,
          variable: {
            name: variable.name,
            class: variable.class,
            type: {
              value: variable.type.value,
              definition: variable.type.definition,
            },
          },
        }
      : {
          string: 'NOT CONNECTED',
          variable: {
            name: '',
            class: '',
            type: {
              value: '',
              definition: '',
            },
          },
        }
  }, [connection])

  /**
   * useEffect to focus the variable input when the block is selected
   */
  useEffect(() => {
    if (data.variable && data.variable.name !== '') {
      setVariableValue(data.variable.name)
      return
    }
  }, [])

  /**
   * Update inputError state when the table of variables is updated
   */
  useEffect(() => {
    const { node: variableNode, variables } = getFBDPouVariablesRungNodeAndEdges(editor, pous, fbdFlows, {
      nodeId: id,
      variableName: variableValue,
    })
    if (!variableNode) return

    const variable = variables.selected
    if (!variable || !inputVariableRef) {
      setIsAVariable(false)
    } else {
      // if the variable is not the same as the one in the node, update the node
      if (variable.id !== (variableNode as VariableNode).data.variable.id) {
        updateNode({
          editorName: editor.meta.name,
          nodeId: variableNode.id,
          node: {
            ...variableNode,
            data: {
              ...variableNode.data,
              variable: variable,
            },
          },
        })
      }

      // if the variable is the same as the one in the node, update the node
      if (
        variable.id === (variableNode as VariableNode).data.variable.id &&
        variable.name !== (variableNode as VariableNode).data.variable.name
      ) {
        updateNode({
          editorName: editor.meta.name,
          nodeId: variableNode.id,
          node: {
            ...variableNode,
            data: {
              ...variableNode.data,
              variable: variable,
            },
          },
        })
      }

      const validation = validateVariableType(variable.type.value, connectionType.variable)
      if (!validation.isValid && dataTypes.length > 0) {
        const userDataTypes = dataTypes.map((dataType) => dataType.name)
        validation.isValid = userDataTypes.includes(variable.type.value)
        validation.error = undefined
      }
      setVariableValue(variable.name)
      setInputError(!validation.isValid)
      setIsAVariable(true)
    }

    if (!connection.node) {
      setInputError(true)
      return
    }
  }, [pous])

  /**
   * Handle with the variable input onBlur event
   */
  const handleSubmitVariableValueOnTextareaBlur = (variableName?: string) => {
    const variableNameToSubmit = variableName || variableValue

    const { pou, rung, node } = getFBDPouVariablesRungNodeAndEdges(editor, pous, fbdFlows, {
      nodeId: id,
    })
    if (!pou || !rung || !node) return
    const variableNode = node as VariableNode

    let variable: PLCVariable | { name: string } | undefined = getVariableByName(
      pou.data.variables as PLCVariable[],
      variableNameToSubmit,
    )
    if (!variable) {
      setIsAVariable(false)
      variable = { name: variableNameToSubmit }
    } else {
      setIsAVariable(true)
    }

    updateNode({
      editorName: editor.meta.name,
      nodeId: variableNode.id,
      node: {
        ...variableNode,
        data: {
          ...variableNode.data,
          variable: variable,
        },
      },
    })

    setInputError(false)
  }

  const onChangeHandler = () => {
    if (!openAutocomplete) {
      setOpenAutocomplete(true)
    }
  }

  const onMouseEnter = () => {
    updateModelFBD({
      hoveringElement: { elementId: id, hovering: true },
    })
  }

  const onMouseLeave = () => {
    updateModelFBD({
      hoveringElement: { elementId: null, hovering: false },
    })
  }

  return (
    <>
      <div
        style={{ width: ELEMENT_SIZE, height: ELEMENT_HEIGHT }}
        className={cn(
          'flex items-center justify-center rounded-md border border-neutral-850 bg-white p-1 text-neutral-1000 dark:bg-neutral-900 dark:text-neutral-50',
          'hover:border-transparent hover:ring-2 hover:ring-brand',
          {
            'border-transparent ring-2 ring-brand': selected,
          },
        )}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <div
          className='flex items-center'
          style={{
            width: DEFAULT_VARIABLE_WIDTH,
            height: DEFAULT_VARIABLE_HEIGHT,
          }}
        >
          <HighlightedTextArea
            textAreaClassName={cn('text-center placeholder:text-center text-xs leading-3', {
              'text-yellow-500': !isAVariable,
              'text-red-500': inputError,
            })}
            highlightClassName={cn('text-center placeholder:text-center text-xs leading-3', {})}
            scrollableIndicatorClassName={cn({
              '-right-2': data.variant === 'output-variable' || 'inout-variable',
              '-left-2': data.variant === 'input-variable',
            })}
            placeholder={connectionType.string}
            textAreaValue={variableValue}
            setTextAreaValue={setVariableValue}
            handleSubmit={handleSubmitVariableValueOnTextareaBlur}
            inputHeight={{
              height: DEFAULT_VARIABLE_HEIGHT / 2,
              scrollLimiter: DEFAULT_VARIABLE_HEIGHT,
            }}
            ref={inputVariableRef}
            onChange={onChangeHandler}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab') e.preventDefault()
              setKeyPressedAtTextarea(e.key)
            }}
            onKeyUp={() => setKeyPressedAtTextarea('')}
          />
          {/* {openAutocomplete && (
          <div className='relative flex justify-center'>
            <div className='absolute -bottom-1'>
              <VariablesBlockAutoComplete
                block={block}
                blockType={'variable'}
                valueToSearch={variableValue}
                isOpen={openAutocomplete}
                setIsOpen={(value) => setOpenAutocomplete(value)}
                keyPressed={keyPressedAtTextarea}
              />
            </div>
          </div>
        )} */}
        </div>
      </div>
      {data.handles.map((handle, index) => (
        <CustomHandle key={index} {...handle} />
      ))}
    </>
  )
}

const buildVariableNode = ({ id, position, variant }: VariableBuilderProps): VariableNode => {
  const inputHandle =
    variant === 'output-variable' || variant === 'inout-variable'
      ? buildHandle({
          id: 'input-variable',
          position: Position.Left,
          type: 'target',
          glbX: position.x,
          glbY: position.y + DEFAULT_VARIABLE_CONNECTOR_Y,
          relX: 0,
          relY: DEFAULT_VARIABLE_CONNECTOR_Y,
        })
      : undefined
  const outputHandle =
    variant === 'input-variable' || variant === 'inout-variable'
      ? buildHandle({
          id: 'output-variable',
          position: Position.Right,
          type: 'source',
          glbX: position.x + DEFAULT_VARIABLE_CONNECTOR_X,
          glbY: position.y + DEFAULT_VARIABLE_CONNECTOR_Y,
          relX: DEFAULT_VARIABLE_CONNECTOR_X,
          relY: DEFAULT_VARIABLE_CONNECTOR_Y,
        })
      : undefined

  return {
    id,
    type: variant,
    position,
    width: ELEMENT_SIZE,
    height: ELEMENT_HEIGHT,
    measured: {
      width: ELEMENT_SIZE,
      height: ELEMENT_HEIGHT,
    },
    data: {
      handles: [inputHandle, outputHandle].filter((handle) => handle !== undefined),
      inputHandles: [inputHandle].filter((handle) => handle !== undefined),
      outputHandles: [outputHandle].filter((handle) => handle !== undefined),
      inputConnector: inputHandle,
      outputConnector: outputHandle,
      numericId: generateNumericUUID(),
      variable: { id: '', name: '' },
      executionOrder: 0,
      variant,
      negated: false,
      draggable: true,
      selectable: true,
      deletable: true,
    },
    deletable: true,
    selectable: true,
    draggable: true,
  }
}

export { buildVariableNode, VariableElement }
