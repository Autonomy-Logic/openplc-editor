import { useOpenPLCStore } from '@root/renderer/store'
import { useEffect } from 'react'

import { DividerActivityBar } from '../../_atoms/workspace-activity-bar/divider'
import { BlockButton, CoilButton, ContactButton } from '../../_molecules/workspace-activity-bar/ladder'

export const LadderToolbox = () => {
  const { editor, flows } = useOpenPLCStore()

  const flow = flows.find((flow) => flow.name === editor.meta.name)

  useEffect(() => {
    if (!flow) return

    console.log('selectedNodes')
    const _selectedNodes = flow.rungs.flatMap((rung) => {
      console.log(
        'rung.nodes',
        rung.nodes,
        rung.nodes.filter((node) => node.selected),
      )
      return rung.nodes.filter((node) => node.selected)
    })
  }, [flow])

  const handleDragStart = (event: React.DragEvent<HTMLDivElement>, iconType: string) => {
    event.dataTransfer.setData('application/reactflow/ladder-blocks', iconType)
    event.dataTransfer.effectAllowed = 'move'
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
    </>
  )
}
