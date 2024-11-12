import { useOpenPLCStore } from '@root/renderer/store'
import { PLCVariable } from '@root/types/PLC'
import { cn, generateNumericUUID } from '@root/utils'
import { Node, NodeProps, Position } from '@xyflow/react'
import { useEffect, useRef, useState } from 'react'

import { InputWithRef } from '../../input'
import { BlockNodeData } from './block'
import { buildHandle, CustomHandle } from './handle'
import { getPouVariablesRungNodeAndEdges } from './utils'
import { BasicNodeData, BuilderBasicProps } from './utils/types'

export type VariableNode = Node<
  BasicNodeData & {
    variant: 'input' | 'output'
    block: {
      id: string
      handleId: string
    }
  }
>
type VariableProps = NodeProps<VariableNode>
type VariableBuilderProps = BuilderBasicProps & {
  variant: 'input' | 'output'
  block: {
    id: string
    handleId: string
  }
  variable: PLCVariable | undefined
}

export const DEFAULT_VARIABLE_WIDTH = 80
export const DEFAULT_VARIABLE_HEIGHT = 32

export const DEFAULT_VARIABLE_CONNECTOR_X = DEFAULT_VARIABLE_WIDTH
export const DEFAULT_VARIABLE_CONNECTOR_Y = DEFAULT_VARIABLE_HEIGHT / 2

const VariableElement = ({ id, data }: VariableProps) => {
  const {
    editor,
    project: {
      data: { pous },
    },
    flows,
    flowActions: { updateNode },
  } = useOpenPLCStore()

  const inputVariableRef = useRef<HTMLInputElement>(null)
  const [inputVariableFocus, setInputVariableFocus] = useState<boolean>(true)

  const [variableName, setVariableName] = useState(data.variable.name)
  const [wrongVariable, setWrongVariable] = useState<boolean>(false)

  /**
   * useEffect to focus the variable input when the block is selected
   */
  useEffect(() => {
    if (data.variable && data.variable.name !== '') {
      setVariableName(data.variable.name)
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
    const { variables } = getPouVariablesRungNodeAndEdges(editor, pous, flows, {
      nodeId: id,
      variableName: variableName,
    })

    if (!variables.selected && !inputVariableRef) {
      setWrongVariable(true)
      return
    }

    setWrongVariable(false)
  }, [pous])

  /**
   * Handle with the variable input onBlur event
   */
  const handleSubmitVariableValue = () => {
    const { rung, node, variables } = getPouVariablesRungNodeAndEdges(editor, pous, flows, {
      nodeId: id,
      variableName: variableName,
    })
    if (!rung || !node) return
    const variableNode = node as VariableNode

    const variable = variables.selected
    if (!variable) {
      setWrongVariable(true)
      return
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
    if (!relatedBlock) return

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

    setWrongVariable(false)
  }

  return (
    <>
      <div className={cn('h-fit w-fit')}>
        <InputWithRef
          value={variableName}
          onChange={(e) => {
            setVariableName(e.target.value)
          }}
          style={{
            height: DEFAULT_VARIABLE_HEIGHT,
            width: DEFAULT_VARIABLE_WIDTH,
          }}
          placeholder='???'
          className={cn('bg-transparent text-sm outline-none', {
            'text-red-500': wrongVariable,
            'pl-2 text-left': data.variant === 'output',
            'pr-2 text-right': data.variant === 'input',
          })}
          onFocus={() => setInputVariableFocus(true)}
          onBlur={() => inputVariableFocus && handleSubmitVariableValue()}
          onKeyDown={(e) => e.key === 'Enter' && inputVariableRef.current?.blur()}
          ref={inputVariableRef}
        />
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
    draggable: false,
  }
}

export { buildVariableNode, VariableElement }
