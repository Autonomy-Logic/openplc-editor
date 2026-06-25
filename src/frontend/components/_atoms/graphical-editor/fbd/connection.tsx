import { useEffect, useRef, useState } from 'react'

import { useOpenPLCStore } from '../../../../store'
import { cn } from '../../../../utils/cn'
import { useBoundPou } from '../../../_features/[workspace]/editor/graphical/active-context'
import { HighlightedTextArea } from '../../highlighted-textarea'
import { FBDBlockAutoComplete } from './autocomplete'
import { CustomHandle } from './handle'
import { ConnectorSVGComponent, ContinuationSVGComponent } from './svg'
import {
  CONNECTION_ELEMENT_HEIGHT,
  CONNECTION_ELEMENT_WIDTH,
  DEFAULT_CONNECTION_HEIGHT,
  DEFAULT_CONNECTION_WIDTH,
} from './utils/constants'
import { BasicNodeData, ConnectionProps } from './utils/types'
import { getFBDPouVariablesRungNodeAndEdges } from './utils/utils'

const ConnectionElement = (block: ConnectionProps) => {
  const { id, data, selected, type } = block
  const pouName = useBoundPou()
  const {
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
  const autocompleteRef = useRef<
    HTMLDivElement & {
      focus: () => void
      isFocused: boolean
      selectedVariable: { positionInArray: number; variableName: string }
    }
  >(null)

  const [openAutocomplete, setOpenAutocomplete] = useState<boolean>(false)
  const [keyPressedAtTextarea, setKeyPressedAtTextarea] = useState<string>('')

  const [connectionValue, setConnectionValue] = useState('')
  const [inputError, setInputError] = useState<boolean>(false)

  /**
   * useEffect to focus the variable input when the block is selected
   */
  useEffect(() => {
    if (data.variable && data.variable.name !== '') {
      setConnectionValue(data.variable.name)
      return
    }

    if (inputConnectionRef.current && selected) {
      inputConnectionRef.current.focus()
    }
  }, [])

  /**
   * Update inputError state when the variable is updated
   */
  useEffect(() => {
    const { rung, node: connectionNode } = getFBDPouVariablesRungNodeAndEdges(pouName, pous, fbdFlows, {
      nodeId: id,
    })
    if (!rung || !connectionNode) return

    const connectionBlock = rung.nodes.find(
      (node) =>
        (node.data as BasicNodeData).variable &&
        (node.data as BasicNodeData).variable.name === (connectionNode.data as BasicNodeData).variable.name &&
        (type === 'connector' ? node.type === 'continuation' : node.type === 'connector'),
    )

    if (!connectionBlock) {
      setInputError(true)
    } else {
      setInputError(false)
    }

    if ((connectionNode.data as BasicNodeData).variable.name !== connectionValue) {
      setConnectionValue((connectionNode.data as BasicNodeData).variable.name)
    }
  }, [pous])

  /**
   * Handle with the variable input onBlur event
   */
  const handleSubmitConnectionValueOnTextareaBlur = (connectionName?: string) => {
    const connectionNameToSubmit = connectionName || connectionValue

    const {
      pou,
      rung,
      node: connectionNode,
    } = getFBDPouVariablesRungNodeAndEdges(pouName, pous, fbdFlows, {
      nodeId: id,
    })
    if (!pou || !rung || !connectionNode) return

    const connectionBlock = fbdFlows
      .find((flow) => flow.name === pouName)
      ?.rung?.nodes.find(
        (node) =>
          (type === 'connector' ? node.type === 'continuation' : node.type === 'connector') &&
          (node.data as BasicNodeData).variable.name == connectionNameToSubmit,
      )

    if (!connectionBlock) {
      setInputError(true)
    } else {
      setInputError(false)
    }

    updateNode({
      editorName: pouName,
      nodeId: id,
      node: {
        ...connectionNode,
        data: {
          ...connectionNode.data,
          variable: { id: 'connection', name: connectionNameToSubmit },
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

  const renderInsideComponent = () => {
    return (
      <foreignObject width='100%' height='100%' x='0' y='0' className='relative'>
        <div
          style={{
            width: DEFAULT_CONNECTION_WIDTH,
          }}
          className={cn('absolute flex h-full items-center justify-center p-0.5', {
            'right-1': data.variant === 'connector',
            'left-1': data.variant === 'continuation',
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
                '-right-2': data.variant === 'continuation',
                '-left-2': data.variant === 'connector',
              })}
              placeholder={'Block to connect'}
              textAreaValue={connectionValue}
              setTextAreaValue={setConnectionValue}
              handleSubmit={handleSubmitConnectionValueOnTextareaBlur}
              inputHeight={{
                height: DEFAULT_CONNECTION_HEIGHT / 2,
                scrollLimiter: DEFAULT_CONNECTION_HEIGHT,
              }}
              ref={inputConnectionRef}
              onChange={onChangeHandler}
              onFocus={onChangeHandler}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab') e.preventDefault()
                if (e.key === 'Enter' && (autocompleteRef.current?.selectedVariable.positionInArray ?? -1) !== -1) {
                  inputConnectionRef.current?.blur({ submit: false })
                }
                setKeyPressedAtTextarea(e.key)
              }}
              onKeyUp={() => setKeyPressedAtTextarea('')}
            />
          </div>
        </div>
        {openAutocomplete && (
          <div className='absolute -bottom-1 left-1/2'>
            <FBDBlockAutoComplete
              ref={autocompleteRef}
              block={block}
              valueToSearch={connectionValue}
              isOpen={openAutocomplete}
              setIsOpen={(value) => setOpenAutocomplete(value)}
              keyPressed={keyPressedAtTextarea}
            />
          </div>
        )}
      </foreignObject>
    )
  }

  return (
    <>
      {data.variant === 'continuation' ? (
        <ContinuationSVGComponent
          style={{ width: CONNECTION_ELEMENT_WIDTH, height: CONNECTION_ELEMENT_HEIGHT }}
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
          style={{ width: CONNECTION_ELEMENT_WIDTH, height: CONNECTION_ELEMENT_HEIGHT }}
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

export { ConnectionElement }
