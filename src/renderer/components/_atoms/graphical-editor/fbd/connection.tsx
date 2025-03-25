import { useOpenPLCStore } from '@root/renderer/store'
import { cn, generateNumericUUID } from '@root/utils'
import { Node, NodeProps, Position } from '@xyflow/react'
import { useEffect, useRef, useState } from 'react'

import { HighlightedTextArea } from '../../highlighted-textarea'
import { buildHandle, CustomHandle } from './handle'
import { ConnectorSVGComponent, ContinuationSVGComponent } from './svg'
import { BasicNodeData, BuilderBasicProps } from './utils/types'
import { getFBDPouVariablesRungNodeAndEdges } from './utils/utils'

export type ConnectionNode = Node<
  BasicNodeData & {
    variant: 'connector' | 'continuation'
  }
>
type ConnectionProps = NodeProps<ConnectionNode>
type ConnectionBuilderProps = BuilderBasicProps & {
  variant: 'connector' | 'continuation'
}

export const DEFAULT_CONNECTION_WIDTH = 112
export const DEFAULT_CONNECTION_HEIGHT = 32

export const ELEMENT_WIDTH = 112 + 24
export const ELEMENT_HEIGHT = 48

export const DEFAULT_CONNECTION_CONNECTOR_X = ELEMENT_WIDTH
export const DEFAULT_CONNECTION_CONNECTOR_Y = ELEMENT_HEIGHT / 2

const ConnectionElement = (block: ConnectionProps) => {
  const { id, data, selected } = block
  const {
    editor,
    editorActions: { updateModelFBD },
    fbdFlows,
    fbdFlowActions: { updateNode },
    project: {
      data: { pous },
    },
  } = useOpenPLCStore()

  const inputConnectionRef = useRef<
    HTMLTextAreaElement & {
      blur: ({ submit }: { submit?: boolean }) => void
      isFocused: boolean
    }
  >(null)

  const [openAutocomplete, setOpenAutocomplete] = useState<boolean>(false)
  const [_keyPressedAtTextarea, setKeyPressedAtTextarea] = useState<string>('')

  const [connectionValue, setConnectionValue] = useState('')
  const [inputError, setInputError] = useState<boolean>(false)

  /**
   * useEffect to focus the variable input when the block is selected
   */
  useEffect(() => {
    console.log('ConnectionElement useEffect', { data })
    if (data.variable && data.variable.name !== '') {
      setConnectionValue(data.variable.name)
      return
    }

    if (inputConnectionRef.current && selected) {
      inputConnectionRef.current.focus()
    }
  }, [])

  /**
   * Update inputError state when the table of variables is updated
   */
  useEffect(() => {
    const { variables, node, rung } = getFBDPouVariablesRungNodeAndEdges(editor, pous, fbdFlows, {
      nodeId: id,
    })
    if (!node || !rung) return

    const variable = variables.selected
    if (!variable) {
      setInputError(true)
      return
    }

    if ((node.data as BasicNodeData).variable.id === variable.id) {
      if ((node.data as BasicNodeData).variable.name !== variable.name) {
        updateNode({
          editorName: editor.meta.name,
          nodeId: node.id,
          node: {
            ...node,
            data: {
              ...node.data,
              variable,
            },
          },
        })
        setConnectionValue(variable.name)
        setInputError(false)
        return
      }
    }

    setInputError(false)
  }, [pous])

  /**
   * Handle with the variable input onBlur event
   */
  const handleSubmitConnectionValueOnTextareaBlur = (connectionName?: string) => {
    const connectionNameToSubmit = connectionName || connectionValue

    const { pou, rung, node } = getFBDPouVariablesRungNodeAndEdges(editor, pous, fbdFlows, {
      nodeId: id,
    })
    if (!pou || !rung || !node) return

    const connectionBlock = fbdFlows
      .find((flow) => flow.name === editor.meta.name)
      ?.rung?.nodes.find((node) => (node.data as BasicNodeData).variable.name == connectionNameToSubmit)

    if (!connectionBlock) {
      setInputError(true)
    } else {
      setInputError(false)
    }

    updateNode({
      editorName: editor.meta.name,
      nodeId: id,
      node: {
        ...node,
        data: {
          ...node.data,
          variable: connectionBlock ? connectionBlock.data.variable : { id: '', name: '' },
        },
      },
    })
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

  const renderInsideComponent = () => {
    return (
      <foreignObject width='100%' height='100%' x='0' y='0' className='relative'>
        <div
          style={{
            width: DEFAULT_CONNECTION_WIDTH,
          }}
          className={cn('absolute flex h-full items-center justify-center p-0.5', {
            'right-2': data.variant === 'connector',
            'left-2': data.variant === 'continuation',
          })}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
        >
          <div
            style={{
              height: DEFAULT_CONNECTION_HEIGHT,
            }}
            className={cn('flex w-full flex-row items-center')}
          >
            <HighlightedTextArea
              textAreaClassName={cn('text-center placeholder:text-center text-xs leading-3', {
                'text-red-500': inputError,
              })}
              highlightClassName={cn('text-center placeholder:text-center text-xs leading-3', {})}
              scrollableIndicatorClassName={cn({
                '-right-3': data.variant === 'continuation',
                '-left-3': data.variant === 'connector',
              })}
              placeholder={'Block to connect'}
              textAreaValue={connectionValue}
              setTextAreaValue={setConnectionValue}
              handleSubmit={handleSubmitConnectionValueOnTextareaBlur}
              inputHeight={{
                height: DEFAULT_CONNECTION_HEIGHT,
                scrollLimiter: DEFAULT_CONNECTION_HEIGHT,
              }}
              ref={inputConnectionRef}
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
          <ConnectionsBlockAutoComplete
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
      </foreignObject>
    )
  }

  return (
    <>
      {data.variant === 'continuation' ? (
        <ContinuationSVGComponent
          style={{ width: ELEMENT_WIDTH, height: ELEMENT_HEIGHT }}
          className={cn(
            'fill-white stroke-neutral-850 stroke-1 text-neutral-1000 dark:fill-neutral-900 dark:text-neutral-50',
            'hover:stroke-brand hover:stroke-2',
            {
              'stroke-brand stroke-2': selected,
            },
          )}
        >
          {renderInsideComponent()}
        </ContinuationSVGComponent>
      ) : (
        <ConnectorSVGComponent
          style={{ width: ELEMENT_WIDTH, height: ELEMENT_HEIGHT }}
          className={cn(
            'fill-white stroke-neutral-850 stroke-1 text-neutral-1000 dark:fill-neutral-900 dark:text-neutral-50',
            'hover:stroke-brand hover:stroke-2',
            {
              'stroke-brand stroke-2': selected,
            },
          )}
        >
          {renderInsideComponent()}
        </ConnectorSVGComponent>
      )}
      {data.handles.map((handle, index) => (
        <CustomHandle key={index} {...handle} />
      ))}
    </>
  )
}

const buildConnectionNode = ({ id, position, variant }: ConnectionBuilderProps): ConnectionNode => {
  const inputHandle =
    variant === 'connector'
      ? buildHandle({
          id: 'input',
          position: Position.Left,
          type: 'target',
          glbX: position.x,
          glbY: position.y + DEFAULT_CONNECTION_CONNECTOR_Y,
          relX: 0,
          relY: DEFAULT_CONNECTION_CONNECTOR_Y,
        })
      : undefined
  const outputHandle =
    variant === 'continuation'
      ? buildHandle({
          id: 'output',
          position: Position.Right,
          type: 'source',
          glbX: position.x + DEFAULT_CONNECTION_CONNECTOR_X,
          glbY: position.y + DEFAULT_CONNECTION_CONNECTOR_Y,
          relX: DEFAULT_CONNECTION_CONNECTOR_X,
          relY: DEFAULT_CONNECTION_CONNECTOR_Y,
        })
      : undefined

  return {
    id,
    type: variant,
    position,
    width: ELEMENT_WIDTH,
    height: ELEMENT_HEIGHT,
    measured: {
      width: ELEMENT_WIDTH,
      height: ELEMENT_HEIGHT,
    },
    data: {
      handles: [inputHandle, outputHandle].filter((handle) => handle !== undefined),
      inputHandles: [inputHandle].filter((handle) => handle !== undefined),
      outputHandles: [outputHandle].filter((handle) => handle !== undefined),
      inputConnector: inputHandle,
      outputConnector: outputHandle,
      numericId: generateNumericUUID(),
      executionOrder: 0,
      variant,
      variable: { id: '', name: '' },
      draggable: true,
      selectable: true,
      deletable: true,
    },
    deletable: true,
    selectable: true,
    draggable: true,
  }
}

export { buildConnectionNode, ConnectionElement }
