import { cn } from '@root/utils'

import {
  DebuggerButton,
  DownloadButton,
  PlayButton,
  SearchButton,
  ZoomButton,
} from '../../_molecules/workspace-activity-bar/default'
import { TooltipSidebarWrapperButton } from '../../_molecules/workspace-activity-bar/tooltip-button'

type DefaultWorkspaceActivityBarProps = {
  zoom?: {
    onClick: () => void
  }
}

export const DefaultWorkspaceActivityBar = ({ zoom }: DefaultWorkspaceActivityBarProps) => {
  return (
    <>
      <TooltipSidebarWrapperButton tooltipContent='Search'>
        <SearchButton />
      </TooltipSidebarWrapperButton>
      <TooltipSidebarWrapperButton tooltipContent='Open/Close Toolbox'>
        <ZoomButton {...zoom} />
      </TooltipSidebarWrapperButton>
      <TooltipSidebarWrapperButton tooltipContent='Compile'>
        <DownloadButton />
      </TooltipSidebarWrapperButton>
      {/** TODO: Need to be implemented */}
      <TooltipSidebarWrapperButton tooltipContent='Not implemented yet'>
        <PlayButton className={cn('disabled cursor-not-allowed opacity-50 [&>*:first-child]:hover:bg-transparent')} />
      </TooltipSidebarWrapperButton>
      {/** TODO: Need to be implemented */}
      <TooltipSidebarWrapperButton tooltipContent='Not implemented yet'>
        <DebuggerButton className={cn('disabled cursor-not-allowed opacity-50 [&>*:first-child]:hover:bg-transparent')} />
      </TooltipSidebarWrapperButton>
    </>
  )
}
