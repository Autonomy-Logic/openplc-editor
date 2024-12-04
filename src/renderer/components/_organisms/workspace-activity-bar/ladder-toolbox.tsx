import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import { Node } from '@xyflow/react'
import { useEffect, useState } from 'react'

import { DividerActivityBar } from '../../_atoms/workspace-activity-bar/divider'
import { TrashCanButton } from '../../_molecules/workspace-activity-bar/default'
import { BlockButton, CoilButton, ContactButton } from '../../_molecules/workspace-activity-bar/ladder'

export const LadderToolbox = () => {
  const { editor, flows, flowActions } = useOpenPLCStore()

  const flow = flows.find((flow) => flow.name === editor.meta.name)
  const [selectedNodes, setSelectedNodes] = useState<Node[]>([])

  useEffect(() => {
    if (!flow) return

    setSelectedNodes(
      flow.rungs.flatMap((rung) => {
        console.log('rung.id', rung.id)
        console.log('rung.selectedNodes', rung.selectedNodes)
        return rung.selectedNodes || []
      }),
    )
  }, [flow])

  const handleDragStart = (event: React.DragEvent<HTMLDivElement>, iconType: string) => {
    event.dataTransfer.setData('application/reactflow/ladder-blocks', iconType)
    event.dataTransfer.effectAllowed = 'move'
  }

  const handleRemoveNodes = () => {
    flow?.rungs.forEach((rung) => {
      flowActions.removeNodes({
        nodes: rung.selectedNodes || [],
        editorName: editor.meta.name,
        rungId: rung.id,
      })
      flowActions.setSelectedNodes({
        editorName: editor.meta.name,
        rungId: rung.id,
        nodes: [],
      })
    })
  }

  return (
    <>
      <BlockButton
        onDragStart={(event) => handleDragStart(event, 'block')}
        onDragEnd={(_event) => console.log('drag end ladder toolbox')}
      />
      <CoilButton onDragStart={(event) => handleDragStart(event, 'coil')} />
      <ContactButton onDragStart={(event) => handleDragStart(event, 'contact')} />
      <DividerActivityBar />
      <TrashCanButton
        onClick={handleRemoveNodes}
        className={cn({
          'disabled cursor-not-allowed opacity-50 [&>*:first-child]:hover:bg-transparent': selectedNodes.length === 0,
        })}
      />
    </>
  )
}
