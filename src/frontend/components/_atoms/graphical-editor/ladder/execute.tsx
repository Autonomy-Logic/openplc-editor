import { memo, useCallback } from 'react'

import { useIsDebuggerVisible } from '../../../../hooks/use-debug-value'
import { useOpenPLCStore } from '../../../../store'
import { cn } from '../../../../utils/cn'
import { executeStDocumentUri } from '../../../../utils/PLC/execute-st-uri'
import { useBoundPou } from '../../../_features/[workspace]/editor/graphical/active-context'
import { StCodeField } from '../st-code-field'
import { CustomHandle } from './handle'
import { getLadderPouVariablesRungNodeAndEdges } from './utils'
import {
  DEFAULT_EXECUTE_BODY_TOP,
  DEFAULT_EXECUTE_CONNECTOR_Y,
  DEFAULT_EXECUTE_HEIGHT,
  DEFAULT_EXECUTE_WIDTH,
  executeHeight,
} from './utils/constants'
import type { ExecuteProps } from './utils/types'

export type { ExecuteNode } from './utils/types'

/**
 * Execute ("ST Block") — a ladder element holding a raw ST snippet.
 *
 * Rendered as a standard ladder block: the same chrome as `BlockNodeVisual` on
 * the same `DEFAULT_BLOCK_CONNECTOR_Y` geometry, so the layout aligns it like
 * any block and the rung wire runs straight through.
 *
 * `EN` / `ENO` are always shown — execution control is what gates the snippet.
 * Electrically the box is a coil: ENO is EN, so power conducts through to
 * whatever follows.
 */
const Execute = (block: ExecuteProps) => {
  const { id, data, selected, width, height } = block
  const pouName = useBoundPou()
  const updateNode = useOpenPLCStore((state) => state.ladderFlowActions.updateNode)
  const openModal = useOpenPLCStore((state) => state.modalActions.openModal)
  const isDebuggerVisible = useIsDebuggerVisible()

  // The modal edits the same document URI, so diagnostics attach to whichever
  // surface is up. Two Monaco editors on one model path fight over it, so only
  // one may be live at a time; the modal wins.
  const expandedModal = useOpenPLCStore((state) => state.modals['execute-ladder-element'])
  const isExpanded = expandedModal.open && (expandedModal.data as { id?: string } | null)?.id === id

  // Grow / shrink as the user types. The code is only written back on blur, so
  // without this the box keeps its committed height while the text runs past
  // the bottom. Transient — resizing must not mark the POU dirty on its own.
  const handleLineCountChange = useCallback(
    (lineCount: number) => {
      const nextHeight = executeHeight(lineCount)
      const { project, ladderFlows } = useOpenPLCStore.getState()
      const { rung, node } = getLadderPouVariablesRungNodeAndEdges(pouName, project.data.pous, ladderFlows, {
        nodeId: id,
      })
      if (!rung || !node || node.height === nextHeight) return

      updateNode({
        editorName: pouName,
        rungId: rung.id,
        nodeId: id,
        node: {
          ...node,
          height: nextHeight,
          measured: { width: node.width ?? DEFAULT_EXECUTE_WIDTH, height: nextHeight },
        },
        transient: true,
      })
    },
    [id, pouName, updateNode],
  )

  const handleCommit = useCallback(
    (nextCode: string) => {
      // Re-read from the store: the rung id isn't on the node, and it may have
      // been re-laid-out since this callback was made.
      const { project, ladderFlows } = useOpenPLCStore.getState()
      const { rung, node } = getLadderPouVariablesRungNodeAndEdges(pouName, project.data.pous, ladderFlows, {
        nodeId: id,
      })
      if (!rung || !node) return
      if ((node.data as { code?: string }).code === nextCode) return

      const nextHeight = executeHeight(nextCode === '' ? 0 : nextCode.split('\n').length)
      updateNode({
        editorName: pouName,
        rungId: rung.id,
        nodeId: node.id,
        node: {
          ...node,
          height: nextHeight,
          measured: { width: node.width ?? DEFAULT_EXECUTE_WIDTH, height: nextHeight },
          data: { ...node.data, code: nextCode },
        },
      })
    },
    [id, pouName, updateNode],
  )

  return (
    // Bare, unstyled root — border and size live on the inner box, mirroring
    // `Block`. Load-bearing: handles position with `top: <connectorY>` against
    // the nearest positioned ancestor, so bordering this element would shift
    // every handle down by the border width and step the wire into the box.
    <div className='relative'>
      <div
        data-testid={`execute-${id}`}
        style={{ width: width ?? DEFAULT_EXECUTE_WIDTH, height: height ?? DEFAULT_EXECUTE_HEIGHT }}
        className={cn(
          'relative flex flex-col rounded-md border border-neutral-850 bg-white text-neutral-1000',
          'dark:bg-neutral-900 dark:text-neutral-50',
          'hover:border-transparent hover:ring-2 hover:ring-brand',
          selected && 'border-transparent ring-2 ring-brand',
        )}
      >
        {/* Title, centred like a block's type name. */}
        <div className='absolute top-2 w-full truncate bg-transparent px-1 text-center text-xs'>Execute</div>

        <button
          type='button'
          aria-label='Expand ST editor'
          title='Expand ST editor'
          className='absolute right-1 top-1.5 flex h-4 w-4 items-center justify-center rounded-sm hover:bg-neutral-200 dark:hover:bg-neutral-800'
          onClick={(event) => {
            event.stopPropagation()
            openModal('execute-ladder-element', block)
          }}
        >
          <svg viewBox='0 0 12 12' aria-hidden className='h-3 w-3 fill-none stroke-neutral-850 dark:stroke-neutral-300'>
            <path d='M7 1h4v4M11 1 6.5 5.5M5 11H1V7M1 11l4.5-4.5' strokeWidth='1.2' strokeLinecap='round' />
          </svg>
        </button>

        {/* EN / ENO inset at the connector row, as BlockNodeVisual does it. */}
        <div className='absolute text-xs' style={{ top: DEFAULT_EXECUTE_CONNECTOR_Y - 10, left: 6 }}>
          EN
        </div>
        <div className='absolute text-xs' style={{ top: DEFAULT_EXECUTE_CONNECTOR_Y - 10, right: 6 }}>
          ENO
        </div>

        <div
          className='absolute inset-x-1 bottom-1 overflow-hidden rounded-sm border border-neutral-300 dark:border-neutral-800'
          style={{ top: DEFAULT_EXECUTE_BODY_TOP }}
        >
          <StCodeField
            value={data.code}
            onCommit={handleCommit}
            uri={executeStDocumentUri(pouName, id)}
            debugPrefix={isDebuggerVisible ? `${pouName}:` : undefined}
            active={selected === true && !isExpanded}
            onLineCountChange={handleLineCountChange}
          />
        </div>
      </div>

      {data.handles.map((handle, index) => (
        <CustomHandle key={index} {...handle} />
      ))}
    </div>
  )
}

export default memo(Execute)
export { Execute }
