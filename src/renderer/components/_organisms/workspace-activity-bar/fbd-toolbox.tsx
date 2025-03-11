import { BlockButton } from '../../_molecules/workspace-activity-bar/fbd'

export const FBDToolbox = () => {
  const handleDragStart = (event: React.DragEvent<HTMLDivElement>, iconType: string) => {
    event.dataTransfer.setData('application/reactflow/fbd-blocks', iconType)
    event.dataTransfer.effectAllowed = 'move'
  }
  return (
    <>
      <BlockButton onDragStart={(event) => handleDragStart(event, 'block')} />
    </>
  )
}
