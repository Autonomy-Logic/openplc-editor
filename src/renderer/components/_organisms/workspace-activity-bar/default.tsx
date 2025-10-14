import { StopIcon } from '@root/renderer/assets'
import { compileOnlySelectors } from '@root/renderer/hooks'
import { useOpenPLCStore } from '@root/renderer/store'
import type { RuntimeConnection } from '@root/renderer/store/slices/device/types'
import { PLCPou, PLCProjectData } from '@root/types/PLC/open-plc'
import { BufferToStringArray, cn } from '@root/utils'
import { parsePlcStatus } from '@root/utils/plc-status'
import { addPythonLocalVariables } from '@root/utils/python/addPythonLocalVariables'
import { generateSTCode } from '@root/utils/python/generateSTCode'
import { injectPythonCode } from '@root/utils/python/injectPythonCode'
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

  const extractPythonData = (pous: typeof projectData.pous) => {
    return pous
      .filter((pou) => pou.data.body.language === 'python')
      .map((pou) => ({
        name: pou.data.name,
        type: pou.type,
        code: pou.data.body.language === 'python' ? (pou.data.body as { value: string }).value : '',
        documentation: pou.data.documentation,
        variables: pou.data.variables,
      }))
  }

  const compileOnly = compileOnlySelectors.useCompileOnly()
  const connectionStatus = useOpenPLCStore((state) => state.runtimeConnection.connectionStatus)
  const plcStatus = useOpenPLCStore((state): RuntimeConnection['plcStatus'] => state.runtimeConnection.plcStatus)
  const jwtToken = useOpenPLCStore((state) => state.runtimeConnection.jwtToken)
  const runtimeIpAddress = useOpenPLCStore((state) => state.deviceDefinitions.configuration.runtimeIpAddress)

  const handleRequest = () => {
    const boardCore = availableBoards.get(deviceDefinitions.configuration.deviceBoard)?.core || null

    const hasPythonCode = projectData.pous.some((pou: PLCPou) => pou.data.body.language === 'python')

    let processedProjectData: PLCProjectData = projectData

    if (hasPythonCode) {
      const pythonPous = projectData.pous.filter((pou: PLCPou) => pou.data.body.language === 'python')

      pythonPous.forEach((pou) => {
        addLog({
          id: crypto.randomUUID(),
          level: 'info',
          message: `Found Python POU: "${pou.data.name}" (${pou.type})`,
        })
      })

      addLog({
        id: crypto.randomUUID(),
        level: 'info',
        message: `Processing ${pythonPous.length} Python POU(s)...`,
      })

      processedProjectData = addPythonLocalVariables(projectData)

      const pythonData = extractPythonData(processedProjectData.pous)
      const processedPythonCodes = injectPythonCode(pythonData)

      console.log(processedProjectData)

      let pythonIndex = 0
      processedProjectData.pous = processedProjectData.pous.map((pou: PLCPou) => {
        if (pou.data.body.language === 'python') {
          if (processedPythonCodes[pythonIndex]) {
            const stCode = generateSTCode({
              pouName: pou.data.name,
              allVariables: pou.data.variables,
              processedPythonCode: processedPythonCodes[pythonIndex],
            })

            pou.data.body = {
              language: 'st',
              value: stCode,
            }

            pythonIndex++
          }
        }
        return pou
      })

      addLog({
        id: crypto.randomUUID(),
        level: 'info',
        message: `Successfully processed ${processedPythonCodes.length} Python POU(s)`,
      })
    }

    console.log('processado:', processedProjectData)
    console.log('original:', projectData)

    const runtimeIpAddress = deviceDefinitions.configuration.runtimeIpAddress || null
    const runtimeJwtToken = useOpenPLCStore.getState().runtimeConnection.jwtToken || null
    window.bridge.runCompileProgram(
      [
        projectMeta.path,
        deviceDefinitions.configuration.deviceBoard,
        boardCore,
        compileOnly,
        processedProjectData,
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
      const res = await saveProject({ data: projectData, meta: projectMeta }, deviceDefinitions)
      if (!res.success) {
        return
      }

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
      {/** TODO: Need to be implemented */}
      <TooltipSidebarWrapperButton tooltipContent='Not implemented yet'>
        <DebuggerButton className={cn(disabledButtonClass)} />
      </TooltipSidebarWrapperButton>
    </>
  )
}
