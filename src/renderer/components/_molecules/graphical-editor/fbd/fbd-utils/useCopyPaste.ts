import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import { useOpenPLCStore } from '@root/renderer/store'
import { FBDRungState } from '@root/renderer/store/slices'
import { pasteNodesAtFBD } from '@root/renderer/store/slices/fbd/utils'
import { EdgeType, NodeType } from '@root/renderer/store/slices/react-flow'
import { ClipboardType } from '@root/types/clipboard'
import { Edge, Node, ReactFlowInstance, XYPosition } from '@xyflow/react'
import { useCallback, useEffect } from 'react'

export const useFBDClipboard = ({
  mousePosition,
  insideViewport,
  reactFlowInstance,
  rung,
  handleDeleteNodes,
}: {
  mousePosition: { x: number; y: number }
  insideViewport: boolean
  reactFlowInstance: ReactFlowInstance | null
  rung: FBDRungState
  handleDeleteNodes: (nodes: Node[], edges: Edge[]) => void
}) => {
  const { editor, fbdFlowActions } = useOpenPLCStore()

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
    [rung],
  )

  /**
   * Handle cut event in the viewport
   */
  const handleCutEvent = useCallback(
    (event: ClipboardEvent) => {
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
    [rung, handleDeleteNodes],
  )

  /**
   * Handle paste event in the viewport
   */
  const handlePasteEvent = useCallback(
    (event: ClipboardEvent) => {
      const clipboardData = event.clipboardData?.getData('fbd:nodes')
      if (!clipboardData) {
        toast({
          title: 'Invalid clipboard data',
          description: 'The clipboard data is not valid.',
          variant: 'fail',
        })
        return
      }

      let parsedData: ClipboardType | null = null
      try {
        parsedData = JSON.parse(clipboardData) as ClipboardType
      } catch (_error) {
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
        editorName: editor.meta.name,
      })

      data.edges.forEach((edge) => {
        fbdFlowActions.addEdge({
          edge: edge,
          editorName: editor.meta.name,
        })
      })

      fbdFlowActions.setSelectedNodes({
        nodes: data.nodes,
        editorName: editor.meta.name,
      })

      toast({
        title: 'Pasted from clipboard',
        description: `FBD data pasted from clipboard`,
        variant: 'default',
      })
    },
    [insideViewport, mousePosition, reactFlowInstance, fbdFlowActions, rung],
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
