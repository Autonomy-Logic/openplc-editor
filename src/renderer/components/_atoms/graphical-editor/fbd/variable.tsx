import { useOpenPLCStore } from '@root/renderer/store'
import { RungLadderState } from '@root/renderer/store/slices'
import { PLCVariable } from '@root/types/PLC'
import { cn, generateNumericUUID } from '@root/utils'
import { Node, NodeProps, Position } from '@xyflow/react'
import { useEffect, useRef, useState } from 'react'

import { HighlightedTextArea } from '../../highlighted-textarea'
import { getLadderPouVariablesRungNodeAndEdges, getVariableByName } from '../utils'
import { BlockVariant } from './block'
import { buildHandle, CustomHandle } from './handle'
import { BasicNodeData, BuilderBasicProps } from './utils/types'

export type VariableNode = Node<
  BasicNodeData & {
    variant: 'input-variable' | 'output-variable' | 'inout-variable'
    block:
      | {
          id: string
          handleId: string
          variableType: BlockVariant['variables'][0]
        }
      | undefined
    variable: PLCVariable | { name: string }
    negated: boolean
  }
>
type VariableProps = NodeProps<VariableNode>
type VariableBuilderProps = BuilderBasicProps & {
  variant: 'input-variable' | 'output-variable' | 'inout-variable'
  variable: PLCVariable | undefined
}

export const DEFAULT_VARIABLE_WIDTH = 80
export const DEFAULT_VARIABLE_HEIGHT = 32

export const ELEMENT_SIZE = 128
export const ELEMENT_HEIGHT = 48

export const DEFAULT_VARIABLE_CONNECTOR_X = DEFAULT_VARIABLE_WIDTH
export const DEFAULT_VARIABLE_CONNECTOR_Y = DEFAULT_VARIABLE_HEIGHT / 2

const VariableElement = (block: VariableProps) => {
  const { id, data, selected } = block
  const {
    editor,
    editorActions: { updateModelFBD },
    project: {
      data: { pous },
    },
    ladderFlows,
    ladderFlowActions: { updateNode },
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

  const updateRelatedNode = (_rung: RungLadderState, _variableNode: VariableNode, _variable: PLCVariable) => {}

  /**
   * useEffect to focus the variable input when the block is selected
   */
  useEffect(() => {}, [])

  /**
   * Update inputError state when the table of variables is updated
   */
  useEffect(() => {}, [pous])

  /**
   * Handle with the variable input onBlur event
   */
  const handleSubmitVariableValueOnTextareaBlur = (variableName?: string) => {
    const variableNameToSubmit = variableName || variableValue

    const { pou, rung, node } = getLadderPouVariablesRungNodeAndEdges(editor, pous, ladderFlows, {
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

    updateRelatedNode(rung, variableNode, variable as PLCVariable)
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
              '-right-3': data.variant === 'output-variable' || 'inout-variable',
              '-left-3': data.variant === 'input-variable',
            })}
            placeholder={`${data.block ? `(*${data.block?.variableType.type.value}*)` : 'NOT CONNECTED'}`}
            textAreaValue={variableValue}
            setTextAreaValue={setVariableValue}
            handleSubmit={handleSubmitVariableValueOnTextareaBlur}
            inputHeight={{
              height: DEFAULT_VARIABLE_HEIGHT,
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

const buildVariableNode = ({ id, position, variant, variable }: VariableBuilderProps): VariableNode => {
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
      variable: variable ?? { name: '' },
      executionOrder: 0,
      variant,
      block: undefined,
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
