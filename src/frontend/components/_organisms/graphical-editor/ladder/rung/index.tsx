/**
 * Explain - This is a workaround to avoid the following error:
 * The ```@dnd-kit``` package is not correctly asserted by the lint tool.
 */
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  commentFirstLine,
  LADDER_STYLE,
  LADDER_TYPOGRAPHY,
  rungSummary,
} from '@root/middleware/shared/utils/ladder-layout'
import { memo, type MouseEvent, useCallback, useState } from 'react'

import { StickArrowIcon } from '../../../../../assets/icons/interface/StickArrow'
import { useIsEditingLocked } from '../../../../../hooks/use-editing-lock'
import { useOpenPLCStore } from '../../../../../store'
import type { RungLadderState } from '../../../../../store/slices/ladder'
import { cn } from '../../../../../utils/cn'
import { useBoundPou } from '../../../../_features/[workspace]/editor/graphical/active-context'
import { RungBody } from '../../../../_molecules/graphical-editor/ladder/rung/body'
import { RungCommentLine } from '../../../../_molecules/graphical-editor/ladder/rung/comment-line'
import { RungGutter } from '../../../../_molecules/graphical-editor/ladder/rung/gutter'
import { useLadderPouCanvas } from '../../../../_molecules/graphical-editor/ladder/rung/pou-canvas'
import { RungMenu, type RungMenuItem } from '../../../../_molecules/graphical-editor/ladder/rung/rung-menu'

/** Height of a collapsed rung's single line, in px. */
const COLLAPSED_HEIGHT = 28
/** Top padding of the rung body above its canvas, in px. */
const BODY_TOP = 4

const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
/** The shortcut label of `key` with the platform's command modifier. */
export const modShortcut = (key: string): string => (IS_MAC ? `⌘${key}` : `Ctrl + ${key}`)
export const DELETE_SHORTCUT = IS_MAC ? '⌫' : 'Del'

/** Whether rung `rungId` is open in the active LD editor; rungs are open until collapsed. */
export function useIsRungOpen(rungId: string): boolean {
  return useOpenPLCStore((state) =>
    state.editor.type === 'plc-graphical' && state.editor.graphical.language === 'ld'
      ? (state.editor.graphical.openedRungs.find((entry) => entry.rungId === rungId)?.open ?? true)
      : true,
  )
}

type RungProps = {
  className?: string
  index: number
  id: string
  rung: RungLadderState
  nodeDivergences?: string[]
  isDebuggerActive?: boolean
  selected?: boolean
  onSelect?: (rungId: string, options?: { extend?: boolean; toggle?: boolean }) => void
  editingComment?: boolean
  onEditingCommentChange?: (rungId: string, editing: boolean) => void
}

const Rung = ({
  className,
  index,
  id,
  rung,
  nodeDivergences,
  isDebuggerActive,
  selected = false,
  onSelect,
  editingComment = false,
  onEditingCommentChange,
}: RungProps) => {
  const editorName = useBoundPou()
  const isEditingLocked = useIsEditingLocked()
  const { addComment, duplicateRung } = useOpenPLCStore((state) => state.ladderFlowActions)
  const openModal = useOpenPLCStore((state) => state.modalActions.openModal)
  const updateModelLadder = useOpenPLCStore((state) => state.editorActions.updateModelLadder)
  const isOpen = useIsRungOpen(rung.id)
  const canvas = useLadderPouCanvas()
  const mainWireY = canvas?.layouts.get(rung)?.mainWireY ?? LADDER_STYLE.padT

  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id })
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)

  const comment = rung.comment ?? ''
  const showComment = comment !== '' || editingComment
  const wireTop = isOpen ? (showComment ? LADDER_STYLE.commentH : 0) + BODY_TOP + mainWireY : COLLAPSED_HEIGHT / 2

  const toggleOpen = () => updateModelLadder({ openRung: { rungId: rung.id, open: !isOpen } })
  const setEditing = (editing: boolean) => onEditingCommentChange?.(rung.id, editing && !isEditingLocked)
  const closeMenu = useCallback(() => setMenuAt(null), [])

  const menuItems: RungMenuItem[] = [
    {
      label: 'Duplicate rung',
      shortcut: modShortcut('D'),
      disabled: isEditingLocked,
      onSelect: () => duplicateRung({ editorName, rungId: rung.id }),
    },
    { label: 'Edit comment', shortcut: modShortcut('/'), disabled: isEditingLocked, onSelect: () => setEditing(true) },
    { label: isOpen ? 'Collapse rung' : 'Expand rung', shortcut: modShortcut('.'), onSelect: toggleOpen },
    null,
    {
      label: 'Delete rung',
      shortcut: DELETE_SHORTCUT,
      disabled: isEditingLocked,
      danger: true,
      onSelect: () => openModal('confirm-delete-element', rung),
    },
  ]

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    // The canvas opens the radial menu on a right click; the rung menu replaces it here.
    event.stopPropagation()
    onSelect?.(rung.id, { toggle: false })
    setMenuAt({ x: event.clientX, y: event.clientY })
  }

  return (
    <div
      aria-label='Rung container'
      className={cn('relative w-full', !isOpen && 'border-y border-neutral-200 dark:border-neutral-800', className)}
      id={id}
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...Object.entries(attributes).reduce((acc, [key, value]: [string, string]) => {
        if (key === 'tabIndex') return acc
        return { ...acc, [key]: value }
      }, {})}
    >
      {isOpen ? (
        <>
          {showComment && (
            <RungCommentLine
              comment={comment}
              editing={editingComment}
              onEditingChange={setEditing}
              onCommit={(value) => addComment({ editorName, rungId: rung.id, comment: value })}
            />
          )}
          <RungBody rung={rung} nodeDivergences={nodeDivergences} isDebuggerActive={isDebuggerActive} />
        </>
      ) : (
        <div
          aria-label='Collapsed rung'
          className='flex items-center gap-2 text-neutral-500 dark:text-neutral-400'
          style={{
            height: COLLAPSED_HEIGHT,
            paddingLeft: LADDER_STYLE.gutter + 6,
            fontFamily: LADDER_TYPOGRAPHY.family,
            fontSize: LADDER_TYPOGRAPHY.commentSizePx,
          }}
        >
          <button aria-label='Expand rung' onClick={toggleOpen} className='rounded p-0.5 hover:bg-neutral-100'>
            <StickArrowIcon direction='right' className='stroke-neutral-500' />
          </button>
          <span className='truncate'>{comment === '' ? '(no comment)' : commentFirstLine(comment)}</span>
          <span className='shrink-0'>· {rungSummary(rung.nodes) || 'empty'}</span>
        </div>
      )}
      <RungGutter
        label={index >= 0 ? String(index + 1) : ''}
        selected={selected}
        wireTop={wireTop}
        dragListeners={isDebuggerActive || isEditingLocked ? undefined : listeners}
        onSelect={(event) => onSelect?.(rung.id, { extend: event.shiftKey })}
        onContextMenu={handleContextMenu}
      />
      {menuAt && <RungMenu at={menuAt} items={menuItems} onClose={closeMenu} />}
    </div>
  )
}

const exportRung = memo(Rung)

export { exportRung as Rung }
