import { compileOnlySelectors } from '@root/renderer/hooks'
import { useOpenPLCStore } from '@root/renderer/store'
import { BufferToStringArray, cn } from '@root/utils'
import { useState } from 'react'

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
    deviceDefinitions,
    deviceAvailableOptions: { availableBoards },
    workspace: { editingState },
    consoleActions: { addLog },
    sharedWorkspaceActions: { saveProject },
  } = useOpenPLCStore()

  const [isCompiling, setIsCompiling] = useState(false)

  const disabledButtonClass = 'disabled cursor-not-allowed opacity-50 [&>*:first-child]:hover:bg-transparent'

  const compileOnly = compileOnlySelectors.useCompileOnly()

  const handleRequest = () => {
    const boardCore = availableBoards.get(deviceDefinitions.configuration.deviceBoard)?.core || null
    window.bridge.runCompileProgram(
      [projectMeta.path, deviceDefinitions.configuration.deviceBoard, boardCore, compileOnly, projectData],
      (data: { logLevel?: 'info' | 'error' | 'warning'; message: string | Buffer; closePort?: boolean }) => {
        setIsCompiling(true)
        if (typeof data.message === 'string') {
          data.message
            .trim()
            .split('\n')
            .forEach((line) => {
              addLog({
                id: crypto.randomUUID(),
                level: data.logLevel,
                message: line,
              })
            })
        }
        if (data.message && typeof data.message !== 'string') {
          BufferToStringArray(data.message).forEach((message) => {
            addLog({
              id: crypto.randomUUID(),
              level: data.logLevel,
              message,
            })
          })
        }
        if (data.closePort) {
          setIsCompiling(false)
        }
      },
    )
  }

  const verifyAndCompile = async () => {
    if (editingState === 'unsaved') {
      const res = await saveProject({ data: projectData, meta: projectMeta }, deviceDefinitions)
      if (!res.success) {
        return
      }

      handleRequest()
    } else {
      handleRequest()
    }
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
        <DownloadButton
          disabled={isCompiling}
          className={cn(isCompiling ? `${disabledButtonClass}` : '')}
          // eslint-disable-next-line @typescript-eslint/no-misused-promises
          onClick={() => verifyAndCompile()}
        />
      </TooltipSidebarWrapperButton>
      {/** TODO: Need to be implemented */}
      <TooltipSidebarWrapperButton tooltipContent='Not implemented yet'>
        <PlayButton className={cn(disabledButtonClass)} />
      </TooltipSidebarWrapperButton>
      {/** TODO: Need to be implemented */}
      <TooltipSidebarWrapperButton tooltipContent='Not implemented yet'>
        <DebuggerButton className={cn(disabledButtonClass)} />
      </TooltipSidebarWrapperButton>
    </>
  )
}
