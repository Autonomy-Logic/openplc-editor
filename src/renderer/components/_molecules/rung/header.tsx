import { DraggableProvidedDragHandleProps } from '@hello-pangea/dnd'
import { TrashCanIcon } from '@root/renderer/assets'
import { DragHandleIcon } from '@root/renderer/assets/icons/interface/DragHandle'
import { StickArrowIcon } from '@root/renderer/assets/icons/interface/StickArrow'
import { useOpenPLCStore } from '@root/renderer/store'
import { RungState } from '@root/renderer/store/slices'
import { PLCVariable } from '@root/types/PLC'
import { cn } from '@root/utils'
import { useEffect, useRef, useState } from 'react'

import { HighlightedTextArea } from '../../_atoms'
import { BasicNodeData } from '../../_atoms/react-flow/custom-nodes/utils/types'

type RungHeaderProps = {
  rung: RungState
  isOpen: boolean
  draggableHandleProps: DraggableProvidedDragHandleProps | null
  className: string
  onClick: () => void
}

export const RungHeader = ({ rung, isOpen, draggableHandleProps, className, onClick }: RungHeaderProps) => {
  const {
    editor,
    editorActions: { updateModelVariables },
    project: {
      data: { pous },
    },
    projectActions: { deleteVariable },
    flowActions: { addComment, removeRung },
  } = useOpenPLCStore()

  const editorName = editor.meta.name
  const pou = pous.find((pou) => pou.data.name === editorName)

  const containerRef = useRef<HTMLDivElement>(null)
  const textAreaRef = useRef<HTMLTextAreaElement>(null)
  const [textAreaValue, setTextAreaValue] = useState<string>(rung.comment ?? '')

  useEffect(() => {
    if (containerRef.current && textAreaRef.current) {
      containerRef.current.style.height =
        28 > textAreaRef.current.scrollHeight ? '28px' : `${textAreaRef.current.scrollHeight}px`
    }
  }, [textAreaValue])

  // useEffect(() => {
  //   if (textAreaRef.current) {
  //     textAreaRef.current.style.height = 'auto'
  //     textAreaRef.current.style.height = `${textAreaRef.current.scrollHeight}px`
  //   }
  // }, [textAreaValue])

  useEffect(() => {
    setTextAreaValue(rung.comment ?? '')
  }, [rung.comment])

  const handleRemoveRung = () => {
    /**
     * Remove the variable associated with the block node
     * If the editor is a graphical editor and the variable display is set to table, update the model variables
     * If the variable is the selected row, set the selected row to -1
     *
     * !IMPORTANT: This function must be used inside of components, because the functions deleteVariable and updateModelVariables are just available at the useOpenPLCStore hook
     * -- This block of code references at project:
     *    -- src/renderer/components/_molecules/rung/body.tsx
     *    -- src/renderer/components/_molecules/rung/header.tsx
     *    -- src/renderer/components/_organisms/workspace-activity-bar/ladder-toolbox.tsx
     */
    const blockNodes = rung.nodes.filter((node) => node.type === 'block')
    if (blockNodes.length > 0) {
      let variables: PLCVariable[] = []
      if (pou) variables = [...pou.data.variables] as PLCVariable[]

      blockNodes.forEach((blockNode) => {
        const variableIndex = variables.findIndex(
          (variable) => variable.id === (blockNode.data as BasicNodeData).variable.id,
        )
        if (variableIndex !== -1) {
          deleteVariable({
            rowId: variableIndex,
            scope: 'local',
            associatedPou: editor.meta.name,
          })
          variables.splice(variableIndex, 1)
        }
        if (
          editor.type === 'plc-graphical' &&
          editor.variable.display === 'table' &&
          parseInt(editor.variable.selectedRow) === variableIndex
        ) {
          updateModelVariables({ display: 'table', selectedRow: -1 })
        }
      })
    }

    removeRung(editorName, rung.id)
  }

  return (
    <div
      aria-label='Rung header'
      className={cn(
        'flex w-full flex-row bg-neutral-50 p-1 dark:bg-neutral-900',
        // 'rounded-lg border dark:border-neutral-800',
        {
          'rounded-b-none border-b-0': isOpen,
        },
        className,
      )}
    >
      <div {...(draggableHandleProps ?? {})} className='flex items-center'>
        <DragHandleIcon className='h-7 w-7 fill-[#0464FB] dark:fill-brand-light' />
      </div>
      <div className='flex w-full items-center rounded-lg border border-transparent px-1' ref={containerRef}>
        {/* <textarea
          aria-label='Rung name and description'
          className='w-full resize-none overflow-hidden bg-transparent text-xs outline-none'
          placeholder='Start typing to add a comment to this rung'
          ref={textAreaRef}
          rows={1}
          onChange={(e) => setTextAreaValue(e.target.value)}
          value={textAreaValue}
          onBlur={() => addComment({ editorName, rungId: rung.id, comment: textAreaValue })}
        /> */}
        <HighlightedTextArea
          placeholder='Start typing to add a comment to this rung'
          textAreaClassName='text-left'
          highlightClassName='text-left'
          ref={textAreaRef}
          textAreaValue={textAreaValue}
          setTextAreaValue={setTextAreaValue}
          handleSubmit={() => addComment({ editorName, rungId: rung.id, comment: textAreaValue })}
          submitWith={{ enter: false }}
        />
      </div>
      <div className='flex flex-row gap-1'>
        <button
          aria-label='Delete body button'
          onClick={handleRemoveRung}
          className='h-fit rounded-md p-1 hover:bg-neutral-200 dark:hover:bg-neutral-800'
        >
          <TrashCanIcon className='h-5 w-5 stroke-[#0464FB] dark:stroke-brand-light' />
        </button>
        <button
          aria-label='Expand body button'
          onClick={onClick}
          className='h-fit rounded-md p-1 hover:bg-neutral-200 dark:hover:bg-neutral-800'
        >
          <StickArrowIcon direction={isOpen ? 'up' : 'down'} className='stroke-[#0464FB] dark:stroke-brand-light' />
        </button>
      </div>
    </div>
  )
}
