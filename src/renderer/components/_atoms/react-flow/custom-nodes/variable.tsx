import { useOpenPLCStore } from '@root/renderer/store'
import { baseTypes } from '@root/shared/data'
import { genericTypeSchema, PLCVariable } from '@root/types/PLC'
import { PLCBasetypes } from '@root/types/PLC/units/base-types'
import { cn, generateNumericUUID } from '@root/utils'
import { Node, NodeProps, Position } from '@xyflow/react'
import { useEffect, useRef, useState } from 'react'

import { BlockNodeData, BlockVariant } from './block'
import { buildHandle, CustomHandle } from './handle'
import { getPouVariablesRungNodeAndEdges, getVariableByName } from './utils'
import { BasicNodeData, BuilderBasicProps } from './utils/types'
// import { z } from 'zod'

export type VariableNode = Node<
  BasicNodeData & {
    variant: 'input' | 'output'
    block: {
      id: string
      handleId: string
      variableType: BlockVariant['variables'][0]
    }
  }
>
type VariableProps = NodeProps<VariableNode>
type VariableBuilderProps = BuilderBasicProps & {
  variant: 'input' | 'output'
  block: {
    id: string
    handleId: string
    variableType: BlockVariant['variables'][0]
  }
  variable: PLCVariable | undefined
}

export const DEFAULT_VARIABLE_WIDTH = 80
export const DEFAULT_VARIABLE_HEIGHT = 32

export const DEFAULT_VARIABLE_CONNECTOR_X = DEFAULT_VARIABLE_WIDTH
export const DEFAULT_VARIABLE_CONNECTOR_Y = DEFAULT_VARIABLE_HEIGHT / 2

const validateVariableType = (
  selectedType: string,
  expectedType: BlockVariant['variables'][0],
): { isValid: boolean; error?: string } => {
  const upperSelectedType = selectedType.toUpperCase()
  const upperExpectedType = expectedType.type.value.toUpperCase()

  if (upperExpectedType === 'ANY') {
    const isValidBaseType = baseTypes.includes(upperSelectedType as PLCBasetypes)
    return {
      isValid: isValidBaseType,
      error: isValidBaseType ? undefined : `Expected one of: ${baseTypes.join(', ')}`,
    }
  }

  // Handle generic types
  if (upperExpectedType.includes('ANY')) {
    const validTypes = Object.values(
      genericTypeSchema.shape[upperExpectedType as keyof typeof genericTypeSchema.shape].options,
    )
    return {
      isValid: validTypes.includes(upperSelectedType),
      error: validTypes.includes(upperSelectedType) ? undefined : `Expected one of: ${validTypes.join(', ')}`,
    }
  }

  // Handle specific types
  return {
    isValid: upperSelectedType === upperExpectedType,
    error:
      upperSelectedType === upperExpectedType ? undefined : `Expected: ${upperExpectedType}, Got: ${upperSelectedType}`,
  }
}

const VariableElement = ({ id, data }: VariableProps) => {
  const {
    editor,
    project: {
      data: { pous, dataTypes },
    },
    flows,
    flowActions: { updateNode },
  } = useOpenPLCStore()

  const inputVariableRef = useRef<HTMLTextAreaElement>(null)
  const scrollableIndicatorRef = useRef<HTMLDivElement>(null)
  const [inputVariableFocus, setInputVariableFocus] = useState<boolean>(true)

  const [variableValue, setVariableValue] = useState(data.variable.name)
  const [inputError, setInputError] = useState<boolean>(false)
  const [isAVariable, setIsAVariable] = useState<boolean>(false)

  useEffect(() => {
    if (inputVariableRef.current) {
      inputVariableRef.current.style.height = 'auto'
      inputVariableRef.current.style.height = `${inputVariableRef.current.scrollHeight < DEFAULT_VARIABLE_HEIGHT ? inputVariableRef.current.scrollHeight : DEFAULT_VARIABLE_HEIGHT}px`
      if (scrollableIndicatorRef.current)
        scrollableIndicatorRef.current.style.display =
          inputVariableRef.current.scrollHeight > DEFAULT_VARIABLE_HEIGHT ? 'block' : 'none'
    }
  }, [variableValue])

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
    const {
      node: variableNode,
      rung,
      variables,
    } = getPouVariablesRungNodeAndEdges(editor, pous, flows, {
      nodeId: id,
      variableName: variableValue,
    })
    if (!rung || !variableNode) return

    const variable = variables.selected
    if (!variable || !inputVariableRef) {
      setIsAVariable(false)
    } else {
      if (variable.name !== (variableNode as VariableNode).data.variable.name) {
        setVariableValue(variable.name)
        updateNode({
          editorName: editor.meta.name,
          rungId: rung.id,
          nodeId: variableNode.id,
          node: {
            ...variableNode,
            data: {
              ...variableNode.data,
              variable: variable,
            },
          },
        })

        const relatedBlock = rung.nodes.find((node) => node.id === (variableNode as VariableNode).data.block.id)
        if (!relatedBlock) {
          setInputError(true)
          return
        }

        updateNode({
          editorName: editor.meta.name,
          rungId: rung.id,
          nodeId: relatedBlock.id,
          node: {
            ...relatedBlock,
            data: {
              ...relatedBlock.data,
              connectedVariables: {
                ...(relatedBlock.data as BlockNodeData<object>).connectedVariables,
                [(variableNode as VariableNode).data.block.handleId]: {
                  variable: variable,
                  type: variableNode.data.variant,
                },
              },
            },
          },
        })
      }

      const validation = validateVariableType(variable.type.value, data.block.variableType)
      if (!validation.isValid && dataTypes.length > 0) {
        const userDataTypes = dataTypes.map((dataType) => dataType.name)
        validation.isValid = userDataTypes.includes(variable.type.value)
        validation.error = undefined
      }
      setInputError(!validation.isValid)
      setIsAVariable(true)
    }

    if (!rung) return

    const relatedBlock = rung.nodes.find((node) => node.id === data.block.id)
    if (!relatedBlock) {
      setInputError(true)
      return
    }
  }, [pous])

  /**
   * Handle with the variable input onBlur event
   */
  const handleSubmitVariableValue = () => {
    const { pou, rung, node } = getPouVariablesRungNodeAndEdges(editor, pous, flows, {
      nodeId: id,
    })
    if (!pou || !rung || !node) return
    const variableNode = node as VariableNode

    let variable: PLCVariable | { name: string } | undefined = getVariableByName(
      pou.data.variables as PLCVariable[],
      variableValue,
    )
    if (!variable) {
      setIsAVariable(false)
      variable = { name: variableValue }
    } else {
      setIsAVariable(true)
    }

    updateNode({
      editorName: editor.meta.name,
      rungId: rung.id,
      nodeId: variableNode.id,
      node: {
        ...variableNode,
        data: {
          ...variableNode.data,
          variable: variable,
        },
      },
    })

    const relatedBlock = rung.nodes.find((node) => node.id === variableNode.data.block.id)
    if (!relatedBlock) {
      setInputError(true)
      return
    }

    updateNode({
      editorName: editor.meta.name,
      rungId: rung.id,
      nodeId: relatedBlock.id,
      node: {
        ...relatedBlock,
        data: {
          ...relatedBlock.data,
          connectedVariables: {
            ...(relatedBlock.data as BlockNodeData<object>).connectedVariables,
            [variableNode.data.block.handleId]: {
              variable: variable,
              type: variableNode.data.variant,
            },
          },
        },
      },
    })

    setInputError(false)
  }

  return (
    <>
      <div
        className={cn('relative flex w-fit items-center')}
        style={{ width: DEFAULT_VARIABLE_WIDTH, height: DEFAULT_VARIABLE_HEIGHT }}
      >
        <textarea
          value={variableValue}
          onChange={(e) => {
            setVariableValue(e.target.value)
          }}
          style={{
            scrollbarGutter: 'stable',
          }}
          placeholder={`(*${data.block.variableType.type.value}*)`}
          className={cn(
            'h-full w-full resize-none bg-transparent text-xs leading-3 outline-none [&::-webkit-scrollbar]:hidden',
            {
              'text-yellow-500': !isAVariable,
              'text-red-500': inputError,
              'pl-2 text-left': data.variant === 'output',
              'pr-2 text-right': data.variant === 'input',
            },
          )}
          onFocus={() => setInputVariableFocus(true)}
          onBlur={() => {
            if (inputVariableRef.current) inputVariableRef.current.scrollTop = 0
            inputVariableFocus && handleSubmitVariableValue()
          }}
          onKeyDown={(e) => e.key === 'Enter' && inputVariableRef.current?.blur()}
          rows={1}
          ref={inputVariableRef}
          spellCheck={false}
        />
        <div
          className={cn(`pointer-events-none absolute text-xs`, {
            '-left-2': data.variant === 'input',
            '-right-2': data.variant === 'output',
          })}
          ref={scrollableIndicatorRef}
        >
          ↕
        </div>
      </div>
      {data.handles.map((handle, index) => (
        <CustomHandle key={index} {...handle} />
      ))}
    </>
  )
}

const buildVariableNode = ({
  id,
  posX,
  posY,
  handleX,
  handleY,
  variant,
  block,
  variable,
}: VariableBuilderProps): VariableNode => {
  const inputHandle =
    variant === 'output'
      ? buildHandle({
          id: 'input',
          position: Position.Left,
          isConnectable: false,
          type: 'target',
          glbX: handleX,
          glbY: handleY,
          relX: 0,
          relY: DEFAULT_VARIABLE_CONNECTOR_Y,
        })
      : undefined
  const outputHandle =
    variant === 'input'
      ? buildHandle({
          id: 'output',
          position: Position.Right,
          isConnectable: false,
          type: 'source',
          glbX: handleX + DEFAULT_VARIABLE_WIDTH,
          glbY: handleY,
          relX: DEFAULT_VARIABLE_WIDTH,
          relY: DEFAULT_VARIABLE_CONNECTOR_Y,
        })
      : undefined

  return {
    id,
    type: 'variable',
    position: {
      x: posX,
      y: posY,
    },
    width: DEFAULT_VARIABLE_WIDTH,
    height: DEFAULT_VARIABLE_HEIGHT,
    measured: {
      width: DEFAULT_VARIABLE_WIDTH,
      height: DEFAULT_VARIABLE_HEIGHT,
    },
    data: {
      handles: [inputHandle, outputHandle].filter((handle) => handle !== undefined),
      inputHandles: [inputHandle].filter((handle) => handle !== undefined),
      outputHandles: [outputHandle].filter((handle) => handle !== undefined),
      inputConnector: inputHandle,
      outputConnector: outputHandle,
      numericId: generateNumericUUID(),
      variable: variable ?? { name: '' },
      executionOrder: 0,
      variant,
      block,
      draggable: false,
      selectable: true,
      deletable: false,
    },
    deletable: false,
    selectable: true,
    draggable: false,
  }
}

export { buildVariableNode, VariableElement }
