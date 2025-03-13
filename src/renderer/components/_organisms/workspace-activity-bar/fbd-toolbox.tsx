import { BlockButton, Connection, Connector, InOutVariable, InputVariable, OutVariable } from '../../_molecules/workspace-activity-bar/fbd'

export const FBDToolbox = () => {
  const handleDragStart = (event: React.DragEvent<HTMLDivElement>, iconType: string) => {
    event.dataTransfer.setData('application/reactflow/fbd-blocks', iconType)
    event.dataTransfer.effectAllowed = 'move'
  }
  return (
    <>
      <BlockButton onDragStart={(event) => handleDragStart(event, 'block')} />
      <InOutVariable onDragStart={(event) => handleDragStart(event, 'inout-variable')} />
      <InputVariable onDragStart={(event) => handleDragStart(event, 'input-variable')} />
      <OutVariable onDragStart={(event) => handleDragStart(event, 'output-variable')} />
      <Connector onDragStart={(event) => handleDragStart(event, 'connector')} />
      <Connection onDragStart={(event) => handleDragStart(event, 'connection')} />
    </>
  )
}
