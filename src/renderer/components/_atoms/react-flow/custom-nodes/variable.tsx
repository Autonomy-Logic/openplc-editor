import { useOpenPLCStore } from '@root/renderer/store'
import { PLCVariable } from '@root/types/PLC'
import { cn, generateNumericUUID } from '@root/utils'
import { Node, NodeProps, Position } from '@xyflow/react'
import { useEffect, useRef, useState } from 'react'

import { HighlightedTextArea } from '../../highlighted-textarea'
import { BlockNodeData, BlockVariant } from './block'
import { buildHandle, CustomHandle } from './handle'
import { getPouVariablesRungNodeAndEdges, getVariableByName, validateVariableType } from './utils'
import { BasicNodeData, BuilderBasicProps } from './utils/types'
// import { VariablesBlockAutoComplete } from './variables-block-autocomplete'

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

const VariableElement = (block: VariableProps) => {
  const { id, data } = block
  const {
    editor,
    project: {
      data: { pous, dataTypes },
    },
    flows,
    flowActions: { updateNode },
  } = useOpenPLCStore()

  const inputVariableRef = useRef<HTMLTextAreaElement>(null)

  const [variableValue, setVariableValue] = useState(data.variable.name)
  const [inputError, setInputError] = useState<boolean>(false)
  const [isAVariable, setIsAVariable] = useState<boolean>(false)

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
      <div style={{ width: DEFAULT_VARIABLE_WIDTH, height: DEFAULT_VARIABLE_HEIGHT }}>
        <HighlightedTextArea
          textAreaClassName={cn('text-center text-xs leading-3', {
            'text-yellow-500': !isAVariable,
            'text-red-500': inputError,
            'text-left': data.variant === 'output',
            'text-right': data.variant === 'input',
          })}
          highlightClassName={cn('text-center text-xs leading-3', {
            'text-left': data.variant === 'output',
            'text-right': data.variant === 'input',
          })}
          scrollableIndicatorClassName={cn({
            '-right-3': data.variant === 'output',
            '-left-3': data.variant === 'input',
          })}
          placeholder={`(*${data.block.variableType.type.value}*)`}
          textAreaValue={variableValue}
          setTextAreaValue={setVariableValue}
          handleSubmit={handleSubmitVariableValue}
          inputHeight={{
            height: DEFAULT_VARIABLE_HEIGHT,
            scrollLimiter: DEFAULT_VARIABLE_HEIGHT,
          }}
          ref={inputVariableRef}
        />
        {/* <div className='relative flex justify-center'>
          <div className='absolute -bottom-2'>
            <VariablesBlockAutoComplete block={block} blockType={'variable'} valueToSearch={variableValue} />
          </div>
        </div> */}
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
