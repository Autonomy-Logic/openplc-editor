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
    project: { data: projectData, meta: projectMeta },
    deviceDefinitions: {
      configuration: { deviceBoard },
    },
    consoleActions: { addLog },
  } = useOpenPLCStore()
  const handleRequest = () => {
    // This function is a placeholder for the zoom functionality
    // Todo: Test receive a callback
    window.bridge.runCompileProgram(
      [projectMeta.path, deviceBoard, projectData],
      (data: { logLevel: 'info' | 'error' | 'warning'; message: string }) => {
        console.log('Received from main process:', data)
        addLog({
          id: crypto.randomUUID(),
          type: data.logLevel,
          message: `Received from main process: ${data.message}`,
        })
      },
    )
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
