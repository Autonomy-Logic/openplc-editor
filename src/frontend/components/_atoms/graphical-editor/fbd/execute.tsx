import { NodeResizer } from '@xyflow/react'
import { memo, useCallback, useEffect, useState } from 'react'

import { useIsDebuggerVisible } from '../../../../hooks/use-debug-value'
import { useOpenPLCStore } from '../../../../store'
import { cn } from '../../../../utils/cn'
import { executeStDocumentUri } from '../../../../utils/PLC/execute-st-uri'
import { useBoundPou } from '../../../_features/[workspace]/editor/graphical/active-context'
import { StCodeField } from '../st-code-field'
import { CustomHandle } from './handle'
import {
  DEFAULT_EXECUTE_BODY_TOP,
  DEFAULT_EXECUTE_CONNECTOR_Y,
  DEFAULT_EXECUTE_HEIGHT,
  DEFAULT_EXECUTE_WIDTH,
} from './utils/constants'
import type { ExecuteProps } from './utils/types'

export type { ExecuteNode } from './utils/types'

/**
 * Execute ("ST Block") for FBD — a resizable box holding a raw ST snippet,
 * gated by whatever reaches `EN` and passing that signal through on `ENO`.
 *
 * Free-positioned and user-resizable like the comment element, since FBD has
 * no rung to lay it out. An unwired `EN` means the snippet runs every scan.
 */
const ExecuteElement = (block: ExecuteProps) => {
  const { id, data, selected, width, height } = block
  const pouName = useBoundPou()
  const updateNode = useOpenPLCStore((state) => state.fbdFlowActions.updateNode)
  const updateModelFBD = useOpenPLCStore((state) => state.editorActions.updateModelFBD)
  const openModal = useOpenPLCStore((state) => state.modalActions.openModal)
  const isDebuggerVisible = useIsDebuggerVisible()

  // Only one Monaco surface may own the shared model URI at a time — see the
  // ladder Execute node.
  const expandedModal = useOpenPLCStore((state) => state.modals['execute-fbd-element'])
  const isExpanded = expandedModal.open && (expandedModal.data as { id?: string } | null)?.id === id

  const [focused, setFocused] = useState(false)

  // Monaco's scroll/zoom gestures fight the canvas', so freeze pan and zoom
  // while the field has focus — as the comment element does for its textarea.
  useEffect(() => {
    updateModelFBD({ canEditorZoom: !focused, canEditorPan: !focused })
    return () => updateModelFBD({ canEditorZoom: true, canEditorPan: true })
  }, [focused, updateModelFBD])

  const handleCommit = useCallback(
    (nextCode: string) => {
      const { fbdFlows } = useOpenPLCStore.getState()
      const node = fbdFlows.find((flow) => flow.name === pouName)?.rung.nodes.find((n) => n.id === id)
      if (!node) return
      if ((node.data as { code?: string }).code === nextCode) return

      updateNode({
        editorName: pouName,
        nodeId: id,
        node: { ...node, data: { ...node.data, code: nextCode } },
      })
    },
    [id, pouName, updateNode],
  )

  return (
    <>
      {/* Bare, unstyled root — border and size live on the inner box, mirroring
          `Block`. Bordering this element would shift every handle down by the
          border width and step the wire into it. */}
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
          <div className='absolute top-2 w-full truncate bg-transparent px-1 text-center text-xs'>Execute</div>

          <button
            type='button'
            aria-label='Expand ST editor'
            title='Expand ST editor'
            className='absolute right-1 top-1.5 flex h-4 w-4 items-center justify-center rounded-sm hover:bg-neutral-200 dark:hover:bg-neutral-800'
            onClick={(event) => {
              event.stopPropagation()
              openModal('execute-fbd-element', block)
            }}
          >
            <svg
              viewBox='0 0 12 12'
              aria-hidden
              className='h-3 w-3 fill-none stroke-neutral-850 dark:stroke-neutral-300'
            >
              <path d='M7 1h4v4M11 1 6.5 5.5M5 11H1V7M1 11l4.5-4.5' strokeWidth='1.2' strokeLinecap='round' />
            </svg>
          </button>

          <div className='absolute text-xs' style={{ top: DEFAULT_EXECUTE_CONNECTOR_Y - 10, left: 6 }}>
            EN
          </div>
          <div className='absolute text-xs' style={{ top: DEFAULT_EXECUTE_CONNECTOR_Y - 10, right: 6 }}>
            ENO
          </div>

          <div
            className='absolute inset-x-1 bottom-1 overflow-hidden rounded-sm border border-neutral-300 dark:border-neutral-800'
            style={{ top: DEFAULT_EXECUTE_BODY_TOP }}
            onFocusCapture={() => setFocused(true)}
            onBlurCapture={() => setFocused(false)}
          >
            <StCodeField
              value={data.code}
              onCommit={handleCommit}
              uri={executeStDocumentUri(pouName, id)}
              debugPrefix={isDebuggerVisible ? `${pouName}:` : undefined}
              active={selected === true && !isExpanded}
            />
          </div>
        </div>

        {data.handles.map((handle, index) => (
          <CustomHandle key={index} {...handle} />
        ))}
      </div>
      <NodeResizer
        isVisible={selected ?? false}
        minWidth={DEFAULT_EXECUTE_WIDTH}
        minHeight={DEFAULT_EXECUTE_HEIGHT}
        handleStyle={{ borderRadius: '0', width: '8px', height: '8px' }}
      />
    </>
  )
}

const exportExecuteElement = memo(ExecuteElement)

export { exportExecuteElement as ExecuteElement }
