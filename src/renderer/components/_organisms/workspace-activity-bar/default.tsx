import { StopIcon } from '@root/renderer/assets'
import { compileOnlySelectors } from '@root/renderer/hooks'
import { useOpenPLCStore } from '@root/renderer/store'
import type { RuntimeConnection } from '@root/renderer/store/slices/device/types'
import { matchVariableWithDebugEntry, parseDebugFile } from '@root/renderer/utils/parse-debug-file'
import { BufferToStringArray, cn } from '@root/utils'
import { parsePlcStatus } from '@root/utils/plc-status'
import { useState } from 'react'

import {
  DebuggerButton,
  DownloadButton,
  PlayButton,
  SearchButton,
  ZoomButton,
} from '../../_molecules/workspace-activity-bar/default'
import { TooltipSidebarWrapperButton } from '../../_molecules/workspace-activity-bar/tooltip-button'
import { saveProjectRequest } from '../../_templates'

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
    workspaceActions: { setEditingState },
    consoleActions: { addLog },
  } = useOpenPLCStore()

  const [isCompiling, setIsCompiling] = useState(false)

  const disabledButtonClass = 'disabled cursor-not-allowed opacity-50 [&>*:first-child]:hover:bg-transparent'

  const compileOnly = compileOnlySelectors.useCompileOnly()
  const connectionStatus = useOpenPLCStore((state) => state.runtimeConnection.connectionStatus)
  const plcStatus = useOpenPLCStore((state): RuntimeConnection['plcStatus'] => state.runtimeConnection.plcStatus)
  const jwtToken = useOpenPLCStore((state) => state.runtimeConnection.jwtToken)
  const runtimeIpAddress = useOpenPLCStore((state) => state.deviceDefinitions.configuration.runtimeIpAddress)

  const handleRequest = () => {
    const boardCore = availableBoards.get(deviceDefinitions.configuration.deviceBoard)?.core || null
    const runtimeIpAddress = deviceDefinitions.configuration.runtimeIpAddress || null
    const runtimeJwtToken = useOpenPLCStore.getState().runtimeConnection.jwtToken || null
    window.bridge.runCompileProgram(
      [
        projectMeta.path,
        deviceDefinitions.configuration.deviceBoard,
        boardCore,
        compileOnly,
        projectData,
        runtimeIpAddress,
        runtimeJwtToken,
      ],
      (data: {
        logLevel?: 'info' | 'error' | 'warning'
        message: string | Buffer
        plcStatus?: string
        closePort?: boolean
      }) => {
        setIsCompiling(true)

        if (data.plcStatus) {
          const status = parsePlcStatus(data.plcStatus)
          if (status) {
            useOpenPLCStore.getState().deviceActions.setPlcRuntimeStatus(status)
          }
        }

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
      await saveProjectRequest({ data: projectData, meta: projectMeta }, deviceDefinitions, setEditingState)
      handleRequest()
    } else {
      handleRequest()
    }
  }

  const handlePlcControl = async (): Promise<void> => {
    if (!runtimeIpAddress || !jwtToken || connectionStatus !== 'connected') {
      return
    }

    try {
      if (plcStatus === 'RUNNING') {
        const result = await window.bridge.runtimeStopPlc(runtimeIpAddress, jwtToken)
        if (!result.success) {
          addLog({
            id: crypto.randomUUID(),
            level: 'error',
            message: `Failed to stop PLC: ${String(result.error) || 'Unknown error'}`,
          })
          return
        }
      } else {
        const result = await window.bridge.runtimeStartPlc(runtimeIpAddress, jwtToken)
        if (!result.success) {
          addLog({
            id: crypto.randomUUID(),
            level: 'error',
            message: `Failed to start PLC: ${String(result.error) || 'Unknown error'}`,
          })
          return
        }
      }

      const statusResult = await window.bridge.runtimeGetStatus(runtimeIpAddress, jwtToken)
      if (statusResult.success && statusResult.status) {
        const status = parsePlcStatus(statusResult.status)
        if (status) {
          useOpenPLCStore.getState().deviceActions.setPlcRuntimeStatus(status)
        }
      }
    } catch (error) {
      addLog({
        id: crypto.randomUUID(),
        level: 'error',
        message: `PLC control error: ${String(error)}`,
      })
    }
  }

  const handleDebuggerClick = async () => {
    const { workspace, project, deviceDefinitions, workspaceActions, consoleActions } = useOpenPLCStore.getState()

    if (workspace.isDebuggerVisible) {
      workspaceActions.setDebuggerVisible(false)
      return
    }

    if (editingState === 'unsaved') {
      await saveProjectRequest({ data: projectData, meta: projectMeta }, deviceDefinitions, setEditingState)
    }

    const boardTarget = deviceDefinitions.configuration.deviceBoard
    const projectPath = project.meta.path

    consoleActions.addLog({
      id: crypto.randomUUID(),
      level: 'info',
      message: 'Starting debug compilation...',
    })

    window.bridge.runDebugCompilation(
      [projectPath, boardTarget, projectData],
      (data: { logLevel?: 'info' | 'error' | 'warning'; message: string | Buffer; closePort?: boolean }) => {
        if (typeof data.message === 'string') {
          data.message
            .trim()
            .split('\n')
            .forEach((line) => {
              consoleActions.addLog({
                id: crypto.randomUUID(),
                level: data.logLevel,
                message: line,
              })
            })
        }
        if (data.message && typeof data.message !== 'string') {
          BufferToStringArray(data.message).forEach((message) => {
            consoleActions.addLog({
              id: crypto.randomUUID(),
              level: data.logLevel,
              message,
            })
          })
        }

        if (data.closePort) {
          window.bridge
            .readDebugFile(projectPath, boardTarget)
            .then((response: { success: boolean; content?: string; error?: string }) => {
              if (response.success && response.content) {
                const parsed = parseDebugFile(response.content)
                const indexMap = new Map<string, number>()

                const { project, editor } = useOpenPLCStore.getState()
                const instances = project.data.configuration.resource.instances
                const currentPouName = editor.meta.name
                const currentInstance = instances.find((inst) => inst.program === currentPouName)

                if (currentInstance) {
                  const currentPou = project.data.pous.find((p) => p.data.name === currentPouName)
                  const debugVariables = currentPou?.data.variables.filter((v) => v.debug === true) || []

                  debugVariables.forEach((v) => {
                    const index = matchVariableWithDebugEntry(v.name, currentInstance.name, parsed.variables)
                    if (index !== null) {
                      indexMap.set(v.name, index)
                    }
                  })
                }

                workspaceActions.setDebugVariableIndexes(indexMap)
                workspaceActions.setDebuggerVisible(true)
                consoleActions.addLog({
                  id: crypto.randomUUID(),
                  level: 'info',
                  message: 'Debug.c parsed successfully. Debugger tab enabled.',
                })
              } else {
                consoleActions.addLog({
                  id: crypto.randomUUID(),
                  level: 'error',
                  message: 'Failed to read debug.c file after compilation.',
                })
              }
            })
            .catch((err: unknown) => {
              consoleActions.addLog({
                id: crypto.randomUUID(),
                level: 'error',
                message: `Error reading debug.c: ${String(err)}`,
              })
            })
        }
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
        <DownloadButton
          disabled={isCompiling}
          className={cn(isCompiling ? `${disabledButtonClass}` : '')}
          // eslint-disable-next-line @typescript-eslint/no-misused-promises
          onClick={() => verifyAndCompile()}
        />
      </TooltipSidebarWrapperButton>
      <TooltipSidebarWrapperButton
        tooltipContent={
          connectionStatus !== 'connected'
            ? 'Connect to runtime first'
            : plcStatus === 'RUNNING'
              ? 'Stop PLC'
              : 'Start PLC'
        }
      >
        <PlayButton
          onClick={() => void handlePlcControl()}
          disabled={connectionStatus !== 'connected'}
          className={cn(connectionStatus !== 'connected' ? disabledButtonClass : '')}
        >
          {plcStatus === 'RUNNING' ? <StopIcon /> : null}
        </PlayButton>
      </TooltipSidebarWrapperButton>
      <TooltipSidebarWrapperButton tooltipContent='Debugger'>
        <DebuggerButton onClick={() => void handleDebuggerClick()} />
      </TooltipSidebarWrapperButton>
    </>
  )
}
