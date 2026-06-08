import { NodeResizer } from '@xyflow/react'
import { memo, useEffect, useRef, useState } from 'react'

import { useOpenPLCStore } from '../../../../store'
import { cn } from '../../../../utils/cn'
import { useBoundPou } from '../../../_features/[workspace]/editor/graphical/active-context'
import { HighlightedTextArea } from '../../highlighted-textarea'
import { getFBDPouVariablesRungNodeAndEdges } from './utils'
import { MINIMUM_ELEMENT_HEIGHT, MINIMUM_ELEMENT_WIDTH } from './utils/constants'
import { CommentNode, CommentProps } from './utils/types'

const CommentElement = (block: CommentProps) => {
  const { id, selected, data, width, height } = block
  const pouName = useBoundPou()
  const {
    editorActions: { updateModelFBD },
    fbdFlows,
    fbdFlowActions: { updateNode },
    project: {
      data: { pous },
    },
  } = useOpenPLCStore()

  const blockRef = useRef<HTMLDivElement>(null)
  const inputVariableRef = useRef<
    HTMLTextAreaElement & {
      blur: ({ submit }: { submit?: boolean }) => void
      isFocused: boolean
    }
  >(null)

  const [commentValue, setCommentValue] = useState(data.content)
  const [commentFocused, setCommentFocused] = useState(false)

  useEffect(() => {
    if (data.content) {
      setCommentValue(data.content)
    }
  }, [])

  const didMountRef = useRef(false)
  useEffect(() => {
    // Skip the initial mount — commentFocused starts as false and the node
    // already has the correct content. Calling updateNode here would mark
    // the flow as updated (unsaved) without any user edit.
    if (!didMountRef.current) {
      didMountRef.current = true
      return
    }

    const { node: commentaryBlock } = getFBDPouVariablesRungNodeAndEdges(pouName, pous, fbdFlows, {
      nodeId: id,
    })
    if (!commentaryBlock) return

    if (commentFocused) {
      updateNode({
        editorName: pouName,
        nodeId: id,
        node: {
          ...commentaryBlock,
          data: {
            ...commentaryBlock.data,
            content: commentValue,
          },
          draggable: false,
          selected: true,
        },
      })
      updateModelFBD({
        canEditorZoom: false,
        canEditorPan: false,
      })
      return
    }

    updateNode({
      editorName: pouName,
      nodeId: id,
      node: {
        ...commentaryBlock,
        data: {
          ...commentaryBlock.data,
          content: commentValue,
        },
        draggable: (commentaryBlock as CommentNode).data.draggable,
        selected: false,
      },
    })
    updateModelFBD({
      canEditorZoom: true,
      canEditorPan: true,
    })

    return () => {
      updateModelFBD({ canEditorZoom: true, canEditorPan: true })
    }
  }, [commentFocused])

  const handleSubmitCommentaryValueOnTextareaBlur = () => {
    const { node: commentaryBlock } = getFBDPouVariablesRungNodeAndEdges(pouName, pous, fbdFlows, {
      nodeId: id,
    })
    if (!commentaryBlock) return

    const parsedCommentValue = commentValue
      .split('\n')
      .filter(
        (line, index, arr) => line.trim() !== '' || arr.slice(index + 1).some((nextLine) => nextLine.trim() !== ''),
      )
      .join('\n')
      .trim()

    setCommentValue(parsedCommentValue)
    updateNode({
      editorName: pouName,
      nodeId: id,
      node: {
        ...commentaryBlock,
        data: {
          ...block.data,
          content: parsedCommentValue,
        },
      },
    })
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
      <div
        ref={blockRef}
        style={{
          width: width ?? MINIMUM_ELEMENT_WIDTH,
          height: height ?? MINIMUM_ELEMENT_HEIGHT,
        }}
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
          className={cn('flex items-center justify-center p-2')}
          style={{
            width: width ?? MINIMUM_ELEMENT_WIDTH,
            height: height ?? MINIMUM_ELEMENT_HEIGHT,
          }}
        >
          <HighlightedTextArea
            ref={inputVariableRef}
            textAreaClassName={cn(
              'text-center placeholder:text-center text-xs leading-3',
              !commentFocused && 'opacity-60',
            )}
            highlightClassName={cn('text-center placeholder:text-center text-xs leading-3')}
            scrollableIndicator={false}
            placeholder={'Add some text...'}
            textAreaValue={commentValue}
            setTextAreaValue={setCommentValue}
            handleSubmit={handleSubmitCommentaryValueOnTextareaBlur}
            onFocus={() => {
              setCommentFocused(true)
            }}
            onBlur={() => {
              setCommentFocused(false)
            }}
            inputHeight={{
              height: (height ?? MINIMUM_ELEMENT_HEIGHT) - 16,
              scrollLimiter: (height ?? MINIMUM_ELEMENT_HEIGHT) - 16,
            }}
            submitWith={{
              enter: false,
            }}
          />
        </div>
      </div>
      <NodeResizer
        isVisible={selected ?? false}
        minWidth={MINIMUM_ELEMENT_WIDTH}
        minHeight={MINIMUM_ELEMENT_HEIGHT}
        handleStyle={{
          borderRadius: '0',
          width: '8px',
          height: '8px',
        }}
      />
    </>
  )
}

const exportCommentElement = memo(CommentElement)

export { exportCommentElement as CommentElement }
