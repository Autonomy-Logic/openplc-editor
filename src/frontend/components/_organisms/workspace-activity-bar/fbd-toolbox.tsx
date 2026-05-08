import { BlockButton } from '../../_molecules/workspace-activity-bar/fbd/block'
import { Comment } from '../../_molecules/workspace-activity-bar/fbd/comment'
import { Connector } from '../../_molecules/workspace-activity-bar/fbd/connector'
import { Continuation } from '../../_molecules/workspace-activity-bar/fbd/continuation'
import { InputVariable } from '../../_molecules/workspace-activity-bar/fbd/input-variable'
import { OutVariable } from '../../_molecules/workspace-activity-bar/fbd/out-variable'
import { TooltipSidebarWrapperButton } from '../../_molecules/workspace-activity-bar/tooltip-button'

export const FBDToolbox = () => {
  const handleDragStart = (event: React.DragEvent<HTMLDivElement>, iconType: string) => {
    event.dataTransfer.setData('application/reactflow/fbd-blocks', iconType)
    event.dataTransfer.setData('text/plain', iconType)
    event.dataTransfer.effectAllowed = 'move'
  }

  return (
    <>
      <TooltipSidebarWrapperButton tooltipContent='Block'>
        <BlockButton onDragStart={(event) => handleDragStart(event, 'block')} />
      </TooltipSidebarWrapperButton>
      <TooltipSidebarWrapperButton tooltipContent='Input Variable'>
        <InputVariable onDragStart={(event) => handleDragStart(event, 'input-variable')} />
      </TooltipSidebarWrapperButton>
      <TooltipSidebarWrapperButton tooltipContent='Output Variable'>
        <OutVariable onDragStart={(event) => handleDragStart(event, 'output-variable')} />
      </TooltipSidebarWrapperButton>
      <TooltipSidebarWrapperButton tooltipContent='Connector'>
        <Connector onDragStart={(event) => handleDragStart(event, 'connector')} />
      </TooltipSidebarWrapperButton>
      <TooltipSidebarWrapperButton tooltipContent='Continuation'>
        <Continuation onDragStart={(event) => handleDragStart(event, 'continuation')} />
      </TooltipSidebarWrapperButton>
      <TooltipSidebarWrapperButton tooltipContent='Comment'>
        <Comment onDragStart={(event) => handleDragStart(event, 'comment')} />
      </TooltipSidebarWrapperButton>
    </>
  )
}
