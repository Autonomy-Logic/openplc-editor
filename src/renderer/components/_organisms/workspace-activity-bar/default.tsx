import { useOpenPLCStore } from '@root/renderer/store'
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
  const {
    consoleActions: { addLog },
  } = useOpenPLCStore()
  const handleRequest = () => {
    // This function is a placeholder for the zoom functionality
    // Todo: Test receive a callback
    window.bridge.runCompileProgram([], (event: MessageEvent) => {
      console.log('Received from main process:', event.data)
      addLog({
        id: crypto.randomUUID(),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        type: event.data.logLevel,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        message: `Received from main process: ${event.data.message}`,
      })
    })
  }
  return (
    <>
      <TooltipSidebarWrapperButton tooltipContent='Search'>
        <SearchButton />
      </TooltipSidebarWrapperButton>
      <TooltipSidebarWrapperButton tooltipContent='Open/Close Toolbox'>
        <ZoomButton {...zoom} />
      </TooltipSidebarWrapperButton>
      <TooltipSidebarWrapperButton tooltipContent='Compile'>
        <DownloadButton onClick={handleRequest} />
      </TooltipSidebarWrapperButton>
      {/** TODO: Need to be implemented */}
      <TooltipSidebarWrapperButton tooltipContent='Not implemented yet'>
        <PlayButton className={cn('disabled cursor-not-allowed opacity-50 [&>*:first-child]:hover:bg-transparent')} />
      </TooltipSidebarWrapperButton>
      {/** TODO: Need to be implemented */}
      <TooltipSidebarWrapperButton tooltipContent='Not implemented yet'>
        <DebuggerButton
          className={cn('disabled cursor-not-allowed opacity-50 [&>*:first-child]:hover:bg-transparent')}
        />
      </TooltipSidebarWrapperButton>
    </>
  )
}
