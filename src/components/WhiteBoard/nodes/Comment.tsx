import '@reactflow/node-resizer/dist/style.css'

import { NodeResizer } from '@reactflow/node-resizer'
import { ChangeEvent, FC, useCallback, useState } from 'react'
import { NodeProps } from 'reactflow'
import { gray } from 'tailwindcss/colors'

import { classNames } from '@/utils'
/**
 * Comment component used for displaying and editing comments within a React Flow diagram node.
 * @param selected - Indicates if the node is currently selected.
 * @param data - Additional data associated with the node.
 */
const Comment: FC<NodeProps> = ({ selected, data }) => {
  // State to manage the number of rows in the textarea.
  const [rows, setRows] = useState(1)
  // State to manage the content of the comment.
  const [comment, setComment] = useState(data.comment)
  // State to track whether the textarea is in focus.
  const [isOnFocus, setIsOnFocus] = useState(false)
  /**
   * Handles the change event when the comment text is modified.
   * @param event - The change event of the textarea.
   */
  const onChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    const textareaLineHeight = 24
    const previousRows = event.target.rows
    event.target.rows = 1

    const currentRows = Math.ceil(
      event.target.scrollHeight / textareaLineHeight,
    )
    if (currentRows === previousRows) {
      event.target.rows = currentRows
    } else {
      setRows(currentRows)
    }

    setComment(event.target.value)
  }, [])

  return (
    <div
      className="scrollbar-white flex h-full min-h-[12.5rem] w-full min-w-[12.5rem] justify-center rounded pt-8 shadow-[-2px_2px_2px_0px_rgba(0,0,0,0.1)]"
      style={{
        background: `linear-gradient(to left bottom, transparent 50%,${gray[200]} 0 ) no-repeat 100% 0 / 2em 2em,linear-gradient(-135deg, transparent 1.41em, white 0)`,
      }}
    >
      <textarea
        id="text"
        name="text"
        onChange={onChange}
        value={comment}
        className={classNames(
          'block w-full resize-none border-0 bg-transparent py-1.5 text-center text-sm text-gray-500 placeholder:text-gray-500 focus:ring-0 dark:text-gray-400 dark:placeholder:text-gray-400',
          isOnFocus ? 'cursor-text' : 'cursor-grab',
        )}
        placeholder="Add an comment here!"
        wrap="soft"
        rows={rows}
        onFocus={() => setIsOnFocus(true)}
        onBlur={() => setIsOnFocus(false)}
      />
      <NodeResizer
        minWidth={200}
        minHeight={200}
        isVisible={selected}
        lineClassName="border-open-plc-blue"
        handleClassName="h-2 w-2 bg-white border-2 rounded border-open-plc-blue"
      />
    </div>
  )
}

export default Comment
