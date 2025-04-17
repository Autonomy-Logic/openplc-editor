import {
  BlockButton,
  Connector,
  Continuation,
  InputVariable,
  OutVariable,
} from '../../_molecules/workspace-activity-bar/fbd'
import { TooltipButton } from '../../_molecules/workspace-activity-bar/tooltip-button'

export const FBDToolbox = () => {
  const handleDragStart = (event: React.DragEvent<HTMLDivElement>, iconType: string) => {
    event.dataTransfer.setData('application/reactflow/fbd-blocks', iconType)
    event.dataTransfer.effectAllowed = 'move'
  }

  return (
    <>
      <TooltipButton tooltipContent='Block'>
        <BlockButton onDragStart={(event) => handleDragStart(event, 'block')} />
      </TooltipButton>
      <TooltipButton tooltipContent='Input Variable'>
        <InputVariable onDragStart={(event) => handleDragStart(event, 'input-variable')} />
      </TooltipButton>
      <TooltipButton tooltipContent='Output Variable'>
        <OutVariable onDragStart={(event) => handleDragStart(event, 'output-variable')} />
      </TooltipButton>
      <TooltipButton tooltipContent='Connector'>
        <Connector onDragStart={(event) => handleDragStart(event, 'connector')} />
      </TooltipButton>
      <TooltipButton tooltipContent='Continuation'>
        <Continuation onDragStart={(event) => handleDragStart(event, 'continuation')} />
      </TooltipButton>
    </>
  )
}
