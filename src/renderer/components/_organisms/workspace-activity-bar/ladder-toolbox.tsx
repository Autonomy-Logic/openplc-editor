import { BlockButton, CoilButton, ContactButton, LoopButton } from '../../_molecules/workspace-activity-bar/ladder'

export const LadderToolbox = () => {
  const handleDragStart = (event: React.DragEvent<HTMLDivElement>, iconType: string) => {
    event.dataTransfer.setData('application/reactflow', iconType)
    event.dataTransfer.effectAllowed = 'move'
  }

  return (
    <>
      <BlockButton onDragStart={(event) => handleDragStart(event, 'block')} />
      <CoilButton onDragStart={(event) => handleDragStart(event, 'coil')} />
      <ContactButton onDragStart={(event) => handleDragStart(event, 'contact')} />
      <LoopButton onDragStart={(event) => handleDragStart(event, 'loop')} />
    </>
  )
}
