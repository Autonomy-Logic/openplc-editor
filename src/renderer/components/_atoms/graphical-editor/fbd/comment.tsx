import { useOpenPLCStore } from '@root/renderer/store'
import { cn, generateNumericUUID } from '@root/utils'
import { Node, NodeProps, NodeResizer } from '@xyflow/react'
import { memo, useRef, useState } from 'react'

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

const MINIMUM_ELEMENT_WIDTH = 128
const MINIMUM_ELEMENT_HEIGHT = 64

const CommentElement = (block: CommentProps) => {
  const { id, selected, data } = block
  const {
    editor,
    editorActions: { updateModelFBD },
    fbdFlows,
    fbdFlowActions: { updateNode },
    project: {
      data: { pous },
    },
  } = useOpenPLCStore()

  const inputVariableRef = useRef<
    HTMLTextAreaElement & {
      blur: ({ submit }: { submit?: boolean }) => void
      isFocused: boolean
    }
  >(null)

  const [commentValue, setCommentValue] = useState(data.content)

  const handleSubmitCommentaryValueOnTextareaBlur = () => {
    const { node: commentaryBlock } = getFBDPouVariablesRungNodeAndEdges(editor, pous, fbdFlows, {
      nodeId: id,
    })
    if (!commentaryBlock) return
    updateNode({
      editorName: editor.meta.name,
      nodeId: id,
      node: {
        ...commentaryBlock,
        data: {
          ...block.data,
          content: commentValue,
        },
      },
    })
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
        style={{
          minWidth: MINIMUM_ELEMENT_WIDTH,
          minHeight: MINIMUM_ELEMENT_HEIGHT,
        }}
        className={cn(
          'relative flex h-full w-full items-center justify-center rounded-md border border-neutral-850 bg-white p-1 text-neutral-1000 dark:bg-neutral-900 dark:text-neutral-50',
          'hover:border-transparent hover:ring-2 hover:ring-brand',
          {
            'border-transparent ring-2 ring-brand': selected,
          },
        )}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <HighlightedTextArea
          textAreaClassName={cn('text-center placeholder:text-center text-xs leading-3')}
          highlightClassName={cn('text-center placeholder:text-center text-xs leading-3')}
          scrollableIndicatorClassName={cn('-right-2')}
          placeholder={'Add some text...'}
          textAreaValue={commentValue}
          setTextAreaValue={setCommentValue}
          handleSubmit={handleSubmitCommentaryValueOnTextareaBlur}
          ref={inputVariableRef}
        />
      </div>
      <NodeResizer isVisible={selected} minWidth={MINIMUM_ELEMENT_WIDTH} minHeight={MINIMUM_ELEMENT_HEIGHT} />
    </>
  )
}

const buildCommentNode = ({ id, position }: CommentBuilderProps): CommentNode => {
  return {
    id,
    type: 'comment',
    position,
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
