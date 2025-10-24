import { useOpenPLCStore } from '@root/renderer/store'
import { PLCVariable } from '@root/types/PLC'
import { cn, generateNumericUUID } from '@root/utils'
import { Node, NodeProps, Position } from '@xyflow/react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { HighlightedTextArea } from '../../highlighted-textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../tooltip'
import { BlockVariant } from '../types/block'
import { getVariableByName, validateVariableType } from '../utils'
import { FBDBlockAutoComplete } from './autocomplete'
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

export const DEFAULT_VARIABLE_WIDTH = 112
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

  const autocompleteRef = useRef<
    HTMLDivElement & {
      focus: () => void
      isFocused: boolean
      selectedVariable: { positionInArray: number; variableName: string }
    }
  >(null)

  const [openAutocomplete, setOpenAutocomplete] = useState<boolean>(false)
  const [keyPressedAtTextarea, setKeyPressedAtTextarea] = useState<string>('')

  const [variableValue, setVariableValue] = useState('')
  const [inputError, setInputError] = useState<boolean>(false)
  const [errorDescription, setErrorDescription] = useState<string>('')
  const [isAVariable, setIsAVariable] = useState<boolean>(false)

  /**
   * Get the connection type
   */
  const flow = useMemo(() => fbdFlows.find((flow) => flow.name === editor.meta.name), [fbdFlows, editor])

  const connections = useMemo(() => {
    const rung = flow?.rung
    if (!rung) return []

    const connectedEdges = rung.edges.filter((edge) => edge.source === id || edge.target === id)
    const connectionsTmp = connectedEdges.map((edge) => {
      const isSource = edge.source === id
      const connectedNodeId = isSource ? edge.target : edge.source
      return rung.nodes.find((block) => block.id === connectedNodeId && block.type === 'block')
    })

    return connectionsTmp
      .filter((node): node is BlockNode<BlockVariant> => node !== undefined)
      .map((node, index) => ({
        node,
        edge: connectedEdges[index],
        isSource: connectedEdges[index].source === id,
      }))
  }, [flow])

  const primaryConnection = useMemo(() => {
    const primaryConnection = connections[0]
    return primaryConnection
      ? {
          node: primaryConnection.node,
          targetEdge: primaryConnection.isSource ? undefined : primaryConnection.edge,
          sourceEdge: primaryConnection.isSource ? primaryConnection.edge : undefined,
        }
      : {
          node: undefined,
          targetEdge: undefined,
          sourceEdge: undefined,
        }
  }, [connections])

  const primaryConnectionType = useMemo(() => {
    const variable = primaryConnection.node?.data.variant.variables.find(
      (variable) =>
        variable.name === primaryConnection.sourceEdge?.targetHandle ||
        variable.name === primaryConnection.targetEdge?.sourceHandle,
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
  }, [primaryConnection])

  const allConnectionsType = useMemo(() => {
    return connections.map((connection) => {
      const variable = connection.node?.data.variant.variables.find(
        (variable) => variable.name === connection.edge.sourceHandle || variable.name === connection.edge.targetHandle,
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
    })
  }, [connections])

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
      variableName: data.variable.name,
    })
    if (!variableNode) return

    const variable = variables.selected
    if (!variable || !inputVariableRef) {
      setIsAVariable(false)
    } else {
      const nodeVariableName = (variableNode as VariableNode).data.variable.name

      if (variable.name.toLowerCase() !== nodeVariableName.toLowerCase()) {
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

      if (variable.name.toLowerCase() === nodeVariableName.toLowerCase() && variable.name !== nodeVariableName) {
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

      let isValid = allConnectionsType.every(
        (connection) => validateVariableType(variable.type.value, connection.variable).isValid,
      )

      if (!isValid && dataTypes.length > 0) {
        const userDataTypes = dataTypes.map((dataType) => dataType.name)
        isValid = userDataTypes.includes(variable.type.value)
      }

      if (!isValid) {
        const validWithPrimaryConnection = validateVariableType(
          variable.type.value,
          primaryConnectionType.variable,
        ).isValid

        if (!validWithPrimaryConnection) {
          setErrorDescription(
            `Variable type ${variable.type.value} is not compatible with ${primaryConnectionType.variable.name}`,
          )
        } else {
          setErrorDescription(
            `Variable type ${variable.type.value} is not compatible with one or more connections: ${allConnectionsType
              .map((connection) => connection.variable.name)
              .join(', ')}`,
          )
        }
      } else {
        setErrorDescription('')
      }

      setVariableValue(variable.name)
      setInputError(!isValid)
      setIsAVariable(true)
    }

    if (!connections.length) {
      setErrorDescription('Variable not connected')
      setInputError(true)
      return
    }
  }, [pous, data.variable.name])

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
      canEditorZoom: false,
      hoveringElement: { elementId: id, hovering: true },
    })
  }

  const onMouseLeave = () => {
    updateModelFBD({
      canEditorZoom: true,
      hoveringElement: { elementId: null, hovering: false },
    })
  }

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <div
              style={{ width: ELEMENT_SIZE, height: ELEMENT_HEIGHT }}
              className={cn(
                'relative flex items-center justify-center rounded-md border border-neutral-850 bg-white p-1 text-neutral-1000 dark:bg-neutral-900 dark:text-neutral-50',
                'hover:border-transparent hover:ring-2 hover:ring-brand',
                {
                  'border-transparent ring-2 ring-brand': selected,
                },
              )}
              onMouseEnter={onMouseEnter}
              onMouseLeave={onMouseLeave}
            >
              <div
                className='relative flex items-center'
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
                    '-right-1': data.variant === 'output-variable' || data.variant === 'inout-variable',
                    '-left-1': data.variant === 'input-variable',
                  })}
                  placeholder={primaryConnectionType.string}
                  textAreaValue={variableValue}
                  setTextAreaValue={setVariableValue}
                  handleSubmit={handleSubmitVariableValueOnTextareaBlur}
                  inputHeight={{
                    height: DEFAULT_VARIABLE_HEIGHT / 2,
                    scrollLimiter: DEFAULT_VARIABLE_HEIGHT,
                  }}
                  ref={inputVariableRef}
                  onChange={onChangeHandler}
                  onFocus={onChangeHandler}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab') e.preventDefault()
                    if (e.key === 'Enter' && autocompleteRef.current?.selectedVariable.positionInArray !== -1) {
                      inputVariableRef.current?.blur({ submit: false })
                    }
                    setKeyPressedAtTextarea(e.key)
                  }}
                  onKeyUp={() => setKeyPressedAtTextarea('')}
                />
              </div>
              {openAutocomplete && (
                <div className='absolute -bottom-2'>
                  <FBDBlockAutoComplete
                    ref={autocompleteRef}
                    block={block}
                    valueToSearch={variableValue}
                    isOpen={openAutocomplete}
                    setIsOpen={(value) => setOpenAutocomplete(value)}
                    keyPressed={keyPressedAtTextarea}
                  />
                </div>
              )}
            </div>
          </TooltipTrigger>
          {inputError && (
            <TooltipContent>
              {errorDescription && (
                <div className='flex items-center justify-center text-xs'>
                  <span className='text-red-500'>{errorDescription}</span>
                </div>
              )}
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>
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
      variable: { name: '' },
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
    selected: true,
  }
}

export { buildVariableNode, VariableElement }
