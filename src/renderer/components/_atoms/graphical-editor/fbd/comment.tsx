import { useOpenPLCStore } from '@root/renderer/store'
import { cn, generateNumericUUID } from '@root/utils'
import { Node, NodeProps, NodeResizer } from '@xyflow/react'
import { memo, useEffect, useRef, useState } from 'react'

import { HighlightedTextArea } from '../../highlighted-textarea'
import { getFBDPouVariablesRungNodeAndEdges } from './utils'
import { BasicNodeData, BuilderBasicProps } from './utils/types'

export type CommentNode = Node<
  Pick<BasicNodeData, 'deletable' | 'draggable' | 'selectable' | 'numericId'> & {
    content: string
  }
>
type CommentProps = NodeProps<CommentNode>
type CommentBuilderProps = BuilderBasicProps

const MINIMUM_ELEMENT_WIDTH = 144
const MINIMUM_ELEMENT_HEIGHT = 80

const CommentElement = (block: CommentProps) => {
  const { id, selected, data, width, height } = block
  const {
    editor,
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

  useEffect(() => {
    const { node: commentaryBlock } = getFBDPouVariablesRungNodeAndEdges(editor, pous, fbdFlows, {
      nodeId: id,
    })
    if (!commentaryBlock) return

    if (commentFocused) {
      updateNode({
        editorName: editor.meta.name,
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
      editorName: editor.meta.name,
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
  }, [commentFocused])

  const handleSubmitCommentaryValueOnTextareaBlur = () => {
    const { node: commentaryBlock } = getFBDPouVariablesRungNodeAndEdges(editor, pous, fbdFlows, {
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
      editorName: editor.meta.name,
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
      <NodeResizer isVisible={selected ?? false} minWidth={MINIMUM_ELEMENT_WIDTH} minHeight={MINIMUM_ELEMENT_HEIGHT} />
    </>
  )
}

const buildCommentNode = ({ id, position }: CommentBuilderProps): CommentNode => {
  return {
    id,
    type: 'comment',
    position,
    width: MINIMUM_ELEMENT_WIDTH,
    height: MINIMUM_ELEMENT_HEIGHT,
    measured: {
      width: MINIMUM_ELEMENT_WIDTH,
      height: MINIMUM_ELEMENT_HEIGHT,
    },
    data: {
      numericId: generateNumericUUID(),
      draggable: true,
      selectable: true,
      deletable: true,
      content: '',
    },
    deletable: true,
    selectable: true,
    draggable: true,
    selected: true,
  }
}

const exportCommentElement = memo(CommentElement)

export { buildCommentNode, exportCommentElement as CommentElement }
