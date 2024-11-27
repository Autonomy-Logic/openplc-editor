import { BlockButton, CoilButton, ContactButton } from '../../_molecules/workspace-activity-bar/ladder'

export const LadderToolbox = () => {
  const handleDragStart = (event: React.DragEvent<HTMLDivElement>, iconType: string) => {
    event.dataTransfer.setData('application/reactflow/ladder-blocks', iconType)
    event.dataTransfer.effectAllowed = 'move'
  }

  return (
    <>
      <BlockButton
        onDragStart={(event) => handleDragStart(event, 'block')}
        // onDragEnd={(_event) => console.log('drag end ladder toolbox')}
      />
      <CoilButton onDragStart={(event) => handleDragStart(event, 'coil')} />
      <ContactButton onDragStart={(event) => handleDragStart(event, 'contact')} />
    </>
  )
}
