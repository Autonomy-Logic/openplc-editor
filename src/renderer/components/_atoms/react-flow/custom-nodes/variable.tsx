import { useOpenPLCStore } from '@root/renderer/store'
import { cn, generateNumericUUID } from '@root/utils'
import { Node, NodeProps, Position } from '@xyflow/react'
import { useEffect, useRef, useState } from 'react'

import { InputWithRef } from '../../input'
import { buildHandle, CustomHandle } from './handle'
import { getPouVariablesRungNodeAndEdges } from './utils'
import { BasicNodeData, BuilderBasicProps } from './utils/types'

export type VariableNode = Node<BasicNodeData & { variant: 'input' | 'output' }>
type VariableProps = NodeProps<VariableNode>
type VariableBuilderProps = BuilderBasicProps & { variant: 'input' | 'output' }

export const DEFAULT_VARIABLE_WIDTH = 34
export const DEFAULT_VARIABLE_HEIGHT = 16

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
  const handleSubmitVariableVariable = () => {
    const { rung, node, variables } = getPouVariablesRungNodeAndEdges(editor, pous, flows, {
      nodeId: id,
      variableName: variableName,
    })
    if (!rung || !node) return

    const variable = variables.selected
    if (!variable) {
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

  return (
    <>
      <div className='h-fit w-full'>
        <InputWithRef
          value={variableName}
          onChange={(e) => {
            setVariableName(e.target.value)
          }}
          style={{
            height: DEFAULT_VARIABLE_HEIGHT,
          }}
          placeholder='???'
          className={cn('w-fit bg-transparent text-center text-sm outline-none', {
            'text-red-500': wrongVariable,
          })}
          onFocus={() => setInputVariableFocus(true)}
          onBlur={() => inputVariableFocus && handleSubmitVariableVariable()}
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

const buildVariableNode = ({ id, posX, posY, handleX, handleY, variant }: VariableBuilderProps): VariableNode => {
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
          style: { left: -3 },
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
          style: { right: -3 },
        })
      : undefined

  return {
    id,
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
      variable: { name: '' },
      executionOrder: 0,
      variant,
    },
  }
}

export { buildVariableNode, VariableElement }
