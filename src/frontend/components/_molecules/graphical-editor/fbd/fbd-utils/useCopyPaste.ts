import { Edge, Node, ReactFlowInstance, XYPosition } from '@xyflow/react'
import { RefObject, useCallback, useEffect } from 'react'

import { useOpenPLCStore } from '../../../../../store'
import { ClipboardType } from '../../../../../store/slices/clipboard/types'
import type { FBDRungState } from '../../../../../store/slices/fbd'
import { pasteNodesAtFBD } from '../../../../../store/slices/fbd/utils'
import { EdgeType, NodeType } from '../../../../../store/slices/react-flow'
import { toast } from '../../../../_features/[app]/toast/use-toast'
import {
  useBoundPou,
  useIsGraphicalEditorActive,
} from '../../../../_features/[workspace]/editor/graphical/active-context'

export const useFBDClipboard = ({
  mousePosition,
  insideViewport,
  reactFlowInstance,
  rung,
  viewportRef,
  handleDeleteNodes,
}: {
  mousePosition: { x: number; y: number }
  insideViewport: boolean
  reactFlowInstance: ReactFlowInstance | null
  rung: FBDRungState
  /**
   * Scoping ref for the FBD viewport.  Copy / cut / paste listeners
   * are registered on the window (Radix and Monaco compete for the
   * same events, so a viewport-local listener won't see all
   * dispatches), so each handler bails out early when the event
   * target isn't inside this FBD instance's React Flow tree.
   * Without this gate, a multi-mounted FBDBody would intercept
   * every Cmd+C anywhere in the app — Monaco copies, console
   * copies, you name it — and spam "Nothing to copy" toasts.
   */
  viewportRef: RefObject<HTMLDivElement>
  handleDeleteNodes: (nodes: Node[], edges: Edge[]) => void
}) => {
  const pouName = useBoundPou()
  const isActive = useIsGraphicalEditorActive()
  const { fbdFlowActions } = useOpenPLCStore()

  // True when the clipboard event originated from a DOM node inside
  // this FBD instance's viewport.  Used to scope **copy** and **cut**
  // — the operation only makes sense when the user is actually
  // focused inside the FBD tree.  Paste uses a different rule (see
  // below).  The `as globalThis.Node` cast is needed because
  // xyflow's `Node` type shadows the DOM `Node` in this module.
  const isInsideThisFbd = (event: ClipboardEvent): boolean => {
    const target = event.target as globalThis.Node | null
    return Boolean(viewportRef.current && target && viewportRef.current.contains(target))
  }

  /**
   * Set data to clipboard when copying the viewport
   */
  const setDataToClipboard = (event: ClipboardEvent) => {
    event.preventDefault()
    const selectedIds = new Set(rung.selectedNodes.map((n) => n.id))
    const selectedEdges = rung.edges.filter((edge) => selectedIds.has(edge.source) || selectedIds.has(edge.target))
    const clipboard: ClipboardType = {
      language: 'fbd',
      content: {
        nodes: rung.selectedNodes as NodeType[],
        edges: selectedEdges as EdgeType[],
      },
    }
    event.clipboardData?.setData('fbd:nodes', JSON.stringify(clipboard))
  }

  /**
   * Handle copy event in the viewport
   */
  const handleCopyEvent = useCallback(
    (event: ClipboardEvent) => {
      if (!isInsideThisFbd(event)) return
      if (!rung.selectedNodes.length) {
        toast({
          title: 'Nothing to copy',
          description: 'No nodes selected to copy.',
          variant: 'fail',
        })
        return
      }

      setDataToClipboard(event)
      toast({
        title: 'Copied to clipboard',
        description: `FBD data copied to clipboard`,
        variant: 'default',
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rung],
  )

  /**
   * Handle cut event in the viewport
   */
  const handleCutEvent = useCallback(
    (event: ClipboardEvent) => {
      if (!isInsideThisFbd(event)) return
      if (!rung.selectedNodes.length) {
        toast({
          title: 'Nothing to cut',
          description: 'No nodes selected to cut.',
          variant: 'fail',
        })
        return
      }

      setDataToClipboard(event)
      const selectedEdges = rung.edges.filter((edge) =>
        rung.selectedNodes.some((node) => node.id === edge.source || node.id === edge.target),
      )
      handleDeleteNodes(rung.selectedNodes, selectedEdges)
      toast({
        title: 'Cut to clipboard',
        description: `FBD data cut to clipboard`,
        variant: 'default',
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rung, handleDeleteNodes],
  )

  /**
   * Handle paste event in the viewport.
   *
   * Paste can't use the same viewport-target gate as copy/cut: the
   * "Copied to clipboard" toast that fires after Cmd+C can pull
   * focus into Radix's toast portal, so by the time the user
   * presses Cmd+V the event target is outside the React Flow tree
   * even though the user clearly meant to paste into THIS FBD.
   * Two looser checks instead:
   *
   *   - `isActive` — only the currently-visible FBD editor claims
   *     the paste, so multi-mount doesn't fire N pastes when the
   *     user copies from one tab and pastes in another.
   *   - `getData('fbd:nodes')` — if the clipboard doesn't carry
   *     our custom MIME, the recent copy wasn't FBD nodes (Monaco
   *     text, console output, etc.) and we silently let the
   *     browser handle the paste.  Previously we surfaced an
   *     "Invalid clipboard data" toast here, which was noise on
   *     every non-FBD paste anywhere in the app.
   */
  const handlePasteEvent = useCallback(
    (event: ClipboardEvent) => {
      if (!isActive) return
      const clipboardData = event.clipboardData?.getData('fbd:nodes')
      if (!clipboardData) return

      let parsedData: ClipboardType | null = null
      try {
        parsedData = JSON.parse(clipboardData) as ClipboardType
      } catch (e) {
        console.error(e)
        toast({
          title: 'Internal error',
          description: 'Could not parse clipboard data.',
          variant: 'fail',
        })
        return
      }
      if (!parsedData || parsedData.language !== 'fbd') {
        toast({
          title: 'Invalid clipboard data',
          description: 'The clipboard data is not valid for FBD.',
          variant: 'fail',
        })
        return
      }

      const nodePosition: XYPosition = reactFlowInstance
        ? insideViewport
          ? reactFlowInstance.screenToFlowPosition({
              x: mousePosition.x,
              y: mousePosition.y,
            })
          : { x: reactFlowInstance.getViewport().x, y: reactFlowInstance.getViewport().y }
        : { x: 0, y: 0 }
      const data = pasteNodesAtFBD(parsedData.content.nodes as Node[], parsedData.content.edges as Edge[], nodePosition)

      // De-Select all selected nodes
      const newNodes: Node[] = rung.nodes.map((node) => {
        return {
          ...node,
          selected: false,
        }
      })
      newNodes.push(...data.nodes)
      fbdFlowActions.setNodes({
        nodes: newNodes,
        editorName: pouName,
      })

      data.edges.forEach((edge) => {
        fbdFlowActions.addEdge({
          edge: edge,
          editorName: pouName,
        })
      })

      fbdFlowActions.setSelectedNodes({
        nodes: data.nodes,
        editorName: pouName,
      })

      toast({
        title: 'Pasted from clipboard',
        description: `FBD data pasted from clipboard`,
        variant: 'default',
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isActive, insideViewport, mousePosition, reactFlowInstance, fbdFlowActions, rung],
  )

  useEffect(() => {
    window.addEventListener('copy', handleCopyEvent)
    return () => {
      window.removeEventListener('copy', handleCopyEvent)
    }
  }, [handleCopyEvent])

  useEffect(() => {
    window.addEventListener('cut', handleCutEvent)
    return () => {
      window.removeEventListener('cut', handleCutEvent)
    }
  }, [handleCutEvent])

  useEffect(() => {
    window.addEventListener('paste', handlePasteEvent)
    return () => {
      window.removeEventListener('paste', handlePasteEvent)
    }
  }, [handlePasteEvent])
}
