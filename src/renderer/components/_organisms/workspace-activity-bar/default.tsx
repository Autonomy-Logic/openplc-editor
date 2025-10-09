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
  const [isDebuggerProcessing, setIsDebuggerProcessing] = useState(false)

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
                level: data.logLevel ?? 'info',
                message: line,
              })
            })
        }
        if (data.message && typeof data.message !== 'string') {
          BufferToStringArray(data.message).forEach((message) => {
            addLog({
              id: crypto.randomUUID(),
              level: data.logLevel ?? 'info',
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
    const { workspace, project, deviceDefinitions, workspaceActions, consoleActions, deviceActions } =
      useOpenPLCStore.getState()

    if (workspace.isDebuggerVisible) {
      workspaceActions.setDebuggerVisible(false)
      return
    }

    if (isDebuggerProcessing) {
      return
    }

    setIsDebuggerProcessing(true)

    try {
      if (editingState === 'unsaved') {
        await saveProjectRequest({ data: projectData, meta: projectMeta }, deviceDefinitions, setEditingState)
      }

      const boardTarget = deviceDefinitions.configuration.deviceBoard
      const projectPath = project.meta.path
      const onlyCompileBoards = ['OpenPLC Runtime v3', 'OpenPLC Runtime v4', 'Raspberry Pi']
      const isRuntimeTarget = onlyCompileBoards.includes(boardTarget)

      let targetIpAddress: string | undefined

      if (isRuntimeTarget) {
        const connectionStatus = useOpenPLCStore.getState().runtimeConnection.connectionStatus
        const runtimeIpAddress = deviceDefinitions.configuration.runtimeIpAddress

        if (connectionStatus !== 'connected' || !runtimeIpAddress) {
          await window.bridge.dialogShowMessageBox({
            type: 'warning',
            title: 'Connection Required',
            message: 'You need to connect to the target before starting a debugger session.',
            buttons: ['OK'],
          })
          setIsDebuggerProcessing(false)
          return
        }

        targetIpAddress = runtimeIpAddress
      } else {
        const { modbusTCP, communicationPreferences } = deviceDefinitions.configuration.communicationConfiguration
        const rtuEnabled = communicationPreferences.enabledRTU
        const tcpEnabled = communicationPreferences.enabledTCP

        if (!rtuEnabled && !tcpEnabled) {
          await window.bridge.dialogShowMessageBox({
            type: 'warning',
            title: 'Modbus Required',
            message: 'Modbus must be enabled on the target to start a debugger session.',
            buttons: ['OK'],
          })
          setIsDebuggerProcessing(false)
          return
        }

        let useModbusTcp = false

        if (rtuEnabled && tcpEnabled) {
          const response = await window.bridge.dialogShowMessageBox({
            type: 'question',
            title: 'Select Modbus Protocol',
            message: 'Both Modbus RTU and Modbus TCP are enabled. Which would you like to use?',
            buttons: ['Modbus RTU (Serial)', 'Modbus TCP'],
            defaultId: 1,
          })
          useModbusTcp = response.response === 1
        } else {
          useModbusTcp = tcpEnabled
        }

        if (useModbusTcp) {
          const dhcpEnabled = communicationPreferences.enabledDHCP

          if (dhcpEnabled) {
            const previousIp = deviceDefinitions.temporaryDhcpIp || ''
            const result = await window.bridge.dialogShowInputBox({
              title: 'Target IP Address',
              message: 'Enter the IP address of the target device:',
              defaultValue: previousIp,
            })

            if (result.cancelled) {
              setIsDebuggerProcessing(false)
              return
            }

            targetIpAddress = result.value?.trim()
            if (!targetIpAddress) {
              setIsDebuggerProcessing(false)
              return
            }

            deviceActions.setTemporaryDhcpIp(targetIpAddress)
          } else {
            targetIpAddress = modbusTCP.tcpStaticHostConfiguration.ipAddress || undefined

            if (!targetIpAddress) {
              await window.bridge.dialogShowMessageBox({
                type: 'error',
                title: 'Configuration Error',
                message: 'No IP address configured for Modbus TCP.',
                buttons: ['OK'],
              })
              setIsDebuggerProcessing(false)
              return
            }
          }
        } else {
          consoleActions.addLog({
            id: crypto.randomUUID(),
            level: 'info',
            message: 'Modbus RTU debugger support is not yet implemented. Using Modbus TCP as fallback if available.',
          })

          if (!tcpEnabled) {
            await window.bridge.dialogShowMessageBox({
              type: 'info',
              title: 'Not Implemented',
              message: 'Modbus RTU debugger support is coming soon. Please enable Modbus TCP for now.',
              buttons: ['OK'],
            })
            setIsDebuggerProcessing(false)
            return
          }

          const dhcpEnabled = communicationPreferences.enabledDHCP

          if (dhcpEnabled) {
            const previousIp = deviceDefinitions.temporaryDhcpIp || ''
            const result = await window.bridge.dialogShowInputBox({
              title: 'Target IP Address',
              message: 'Enter the IP address of the target device:',
              defaultValue: previousIp,
            })

            if (result.cancelled) {
              setIsDebuggerProcessing(false)
              return
            }

            targetIpAddress = result.value?.trim()
            if (!targetIpAddress) {
              setIsDebuggerProcessing(false)
              return
            }

            deviceActions.setTemporaryDhcpIp(targetIpAddress)
          } else {
            targetIpAddress = modbusTCP.tcpStaticHostConfiguration.ipAddress || undefined

            if (!targetIpAddress) {
              await window.bridge.dialogShowMessageBox({
                type: 'error',
                title: 'Configuration Error',
                message: 'No IP address configured for Modbus TCP.',
                buttons: ['OK'],
              })
              setIsDebuggerProcessing(false)
              return
            }
          }
        }
      }

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
                  level: data.logLevel ?? 'info',
                  message: line,
                })
              })
          }
          if (data.message && typeof data.message !== 'string') {
            BufferToStringArray(data.message).forEach((message) => {
              consoleActions.addLog({
                id: crypto.randomUUID(),
                level: data.logLevel ?? 'info',
                message,
              })
            })
          }

          if (data.closePort) {
            void handleMd5Verification(projectPath, boardTarget, targetIpAddress)
          }
        },
      )
    } catch (error) {
      consoleActions.addLog({
        id: crypto.randomUUID(),
        level: 'error',
        message: `Error during debugger initialization: ${String(error)}`,
      })
      setIsDebuggerProcessing(false)
    }
  }

  const handleMd5Verification = async (projectPath: string, boardTarget: string, targetIpAddress: string) => {
    const { consoleActions, workspaceActions } = useOpenPLCStore.getState()

    try {
      consoleActions.addLog({
        id: crypto.randomUUID(),
        level: 'info',
        message: 'Extracting MD5 from compiled program...',
      })

      const programStResult = await window.bridge.debuggerReadProgramStMd5(projectPath, boardTarget)

      if (!programStResult.success || !programStResult.md5) {
        consoleActions.addLog({
          id: crypto.randomUUID(),
          level: 'error',
          message: `Failed to extract MD5: ${programStResult.error || 'Unknown error'}`,
        })

        await window.bridge.dialogShowMessageBox({
          type: 'error',
          title: 'MD5 Extraction Failed',
          message: programStResult.error || 'Could not extract MD5 from program.st',
          buttons: ['OK'],
        })
        setIsDebuggerProcessing(false)
        return
      }

      const expectedMd5 = programStResult.md5
      consoleActions.addLog({
        id: crypto.randomUUID(),
        level: 'info',
        message: `Program MD5: ${expectedMd5}`,
      })

      consoleActions.addLog({
        id: crypto.randomUUID(),
        level: 'info',
        message: `Requesting MD5 from target at ${targetIpAddress}...`,
      })

      const verifyResult = await window.bridge.debuggerVerifyMd5(targetIpAddress, expectedMd5)

      if (!verifyResult.success) {
        consoleActions.addLog({
          id: crypto.randomUUID(),
          level: 'error',
          message: `MD5 verification failed: ${verifyResult.error || 'Unknown error'}`,
        })

        await window.bridge.dialogShowMessageBox({
          type: 'error',
          title: 'Connection Error',
          message: `Could not verify MD5 with target: ${verifyResult.error || 'Unknown error'}`,
          buttons: ['OK'],
        })
        setIsDebuggerProcessing(false)
        return
      }

      if (verifyResult.match) {
        console.log('MD5 matched:', expectedMd5)
        consoleActions.addLog({
          id: crypto.randomUUID(),
          level: 'info',
          message: 'MD5 verification successful. Starting debugger...',
        })

        const debugFileResult = await window.bridge.readDebugFile(projectPath, boardTarget)

        if (debugFileResult.success && debugFileResult.content) {
          const parsed = parseDebugFile(debugFileResult.content)
          const indexMap = new Map<string, number>()

          const { project } = useOpenPLCStore.getState()
          const instances = project.data.configuration.resource.instances

          project.data.pous.forEach((pou) => {
            if (pou.type !== 'program') return

            const instance = instances.find((inst) => inst.program === pou.data.name)
            if (!instance) {
              consoleActions.addLog({
                id: crypto.randomUUID(),
                level: 'warning',
                message: `No instance found for program '${pou.data.name}', skipping debug variable parsing.`,
              })
              return
            }

            const debugVariables = pou.data.variables.filter((v) => v.debug === true)

            debugVariables.forEach((v) => {
              const index = matchVariableWithDebugEntry(v.name, instance.name, parsed.variables)
              if (index !== null) {
                const compositeKey = `${pou.data.name}:${v.name}`
                indexMap.set(compositeKey, index)
              }
            })
          })

          workspaceActions.setDebugVariableIndexes(indexMap)
          workspaceActions.setDebuggerVisible(true)
          consoleActions.addLog({
            id: crypto.randomUUID(),
            level: 'info',
            message: `Debugger started successfully. Found ${indexMap.size} debug variables.`,
          })
        } else {
          consoleActions.addLog({
            id: crypto.randomUUID(),
            level: 'error',
            message: 'Failed to read debug.c file after compilation.',
          })
        }
        setIsDebuggerProcessing(false)
      } else {
        consoleActions.addLog({
          id: crypto.randomUUID(),
          level: 'warning',
          message: `MD5 mismatch. Target: ${verifyResult.targetMd5}, Expected: ${expectedMd5}`,
        })

        const response = await window.bridge.dialogShowMessageBox({
          type: 'warning',
          title: 'Program Mismatch',
          message:
            'The program running on the target does not match the program opened in the editor. Would you like to upload the current project to the target?',
          buttons: ['Yes', 'No'],
          defaultId: 0,
        })

        if (response.response === 0) {
          consoleActions.addLog({
            id: crypto.randomUUID(),
            level: 'info',
            message: 'Uploading program to target...',
          })

          const boardCore = availableBoards.get(boardTarget)?.core || null
          const runtimeJwtToken = useOpenPLCStore.getState().runtimeConnection.jwtToken || null

          window.bridge.runCompileProgram(
            [projectPath, boardTarget, boardCore, false, projectData, targetIpAddress, runtimeJwtToken],
            (data: {
              logLevel?: 'info' | 'error' | 'warning'
              message: string | Buffer
              plcStatus?: string
              closePort?: boolean
            }) => {
              if (typeof data.message === 'string') {
                data.message
                  .trim()
                  .split('\n')
                  .forEach((line) => {
                    consoleActions.addLog({
                      id: crypto.randomUUID(),
                      level: data.logLevel ?? 'info',
                      message: line,
                    })
                  })
              }
              if (data.message && typeof data.message !== 'string') {
                BufferToStringArray(data.message).forEach((message) => {
                  consoleActions.addLog({
                    id: crypto.randomUUID(),
                    level: data.logLevel ?? 'info',
                    message,
                  })
                })
              }

              if (data.closePort) {
                consoleActions.addLog({
                  id: crypto.randomUUID(),
                  level: 'info',
                  message: 'Upload completed. Restarting debugger verification...',
                })

                setTimeout(() => {
                  void handleMd5Verification(projectPath, boardTarget, targetIpAddress)
                }, 2000)
              }
            },
          )
        } else {
          consoleActions.addLog({
            id: crypto.randomUUID(),
            level: 'info',
            message: 'Debugger session cancelled.',
          })
          setIsDebuggerProcessing(false)
        }
      }
    } catch (error) {
      consoleActions.addLog({
        id: crypto.randomUUID(),
        level: 'error',
        message: `Unexpected error during MD5 verification: ${String(error)}`,
      })
      setIsDebuggerProcessing(false)
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
      <TooltipSidebarWrapperButton tooltipContent='Debugger'>
        <DebuggerButton
          onClick={() => void handleDebuggerClick()}
          disabled={isDebuggerProcessing}
          className={cn(isDebuggerProcessing && 'cursor-not-allowed opacity-50')}
        />
      </TooltipSidebarWrapperButton>
    </>
  )
}
