import { useEffect } from 'react'

import { useOpenPLCStore } from '../store'
import type { GraphicalFocus } from '../store/slices/editor/types'

/**
 * The focus request is set before the flow exists — opening the tab is what builds it — so
 * `select` reports whether the node is there yet, and `select` must be stable (`useCallback`).
 */
export const useGraphicalFocus = (pouName: string, select: (focus: GraphicalFocus) => boolean): void => {
  const graphicalFocus = useOpenPLCStore((state) => state.editors.find((e) => e.meta.name === pouName)?.graphicalFocus)
  const setEditorGraphicalFocus = useOpenPLCStore((state) => state.editorActions.setEditorGraphicalFocus)

  useEffect(() => {
    if (!graphicalFocus) return
    if (!select(graphicalFocus)) return

    const element = document.querySelector(`[data-id="${graphicalFocus.nodeId}"]`)
    if (element instanceof HTMLElement && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
    }
    setEditorGraphicalFocus(pouName, undefined)
  }, [graphicalFocus, pouName, select, setEditorGraphicalFocus])
}
