import { useCallback, useEffect, useRef, useState } from 'react'

import type { DebugConnectionConfig, DebugTreeNode } from '../../../../middleware/shared/ports/types'
import { useCompiler, useDebugger, useProject, useRuntime, useSimulator } from '../../../../middleware/shared/providers'
import { StopIcon } from '../../../assets/icons/interface/Stop'
import { useOpenPLCStore } from '../../../store'
import type { RuntimeConnection } from '../../../store/slices/device/types'
import { cn } from '../../../utils/cn'
import { parseDebugFile } from '../../../utils/debug-parser'
import {
  buildDebugVariableTreeMap,
  buildFbInstanceMap,
  buildVariableIndexMap,
} from '../../../utils/debugger-session'
import { isOpenPLCRuntimeTarget, isOpenPLCRuntimeV4Target } from '../../../utils/device'
import { getErrorMessage } from '../../../utils/get-error-message'
import { prepareSavePayload } from '../../../utils/save-project'
import { ChatButton } from '../../_molecules/workspace-activity-bar/default/chat'
import { DebuggerButton } from '../../_molecules/workspace-activity-bar/default/debugger'
import { DownloadButton } from '../../_molecules/workspace-activity-bar/default/download'
import { PlayButton } from '../../_molecules/workspace-activity-bar/default/play'
import { SearchButton } from '../../_molecules/workspace-activity-bar/default/search'
import { ZoomButton } from '../../_molecules/workspace-activity-bar/default/zoom'
import { TooltipSidebarWrapperButton } from '../../_molecules/workspace-activity-bar/tooltip-button'

const showDebuggerMessage = (
  type: 'info' | 'warning' | 'error' | 'question',
  title: string,
  message: string,
  buttons: string[],
): Promise<number> => {
  return new Promise((resolve) => {
    useOpenPLCStore.getState().modalActions.openModal('debugger-message', {
      type,
      title,
      message,
      buttons,
      onResponse: (buttonIndex: number) => resolve(buttonIndex),
    })
  })
}

const showDebuggerIpInput = (title: string, message: string, defaultValue: string): Promise<string | null> => {
  return new Promise((resolve) => {
    useOpenPLCStore.getState().modalActions.openModal('debugger-ip-input', {
      title,
      message,
      defaultValue,
      onSubmit: (value: string) => resolve(value),
      onCancel: () => resolve(null),
    })
  })
}

/** Forward compile/debug progress lines to the console log. */
const logCompilerEvent = (
  event: { message?: string; level?: string },
  log: (entry: { id: string; level: 'error' | 'debug' | 'info' | 'warning'; message: string }) => void,
) => {
  if (!event.message) return
  event.message
    .trim()
    .split('\n')
    .forEach((line) => {
      if (line) {
        log({
          id: crypto.randomUUID(),
          level: (event.level as 'error' | 'debug' | 'info' | 'warning') ?? 'info',
          message: line,
        })
      }
    })
}

const disabledButtonClass = 'cursor-not-allowed opacity-50 [&>*:first-child]:hover:bg-transparent'

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
    consoleActions: { addLog },
  } = useOpenPLCStore()

  const compiler = useCompiler()
  const runtime = useRuntime()
  const simulator = useSimulator()
  const debuggerPort = useDebugger()
  const projectPort = useProject()

  const [isCompiling, setIsCompiling] = useState(false)
  const [isDebuggerProcessing, setIsDebuggerProcessing] = useState(false)
  const [simulatorRunning, setSimulatorRunning] = useState(false)
  const pendingSimulatorDebugRef = useRef(false)

  const connectionStatus = useOpenPLCStore((state) => state.runtimeConnection.connectionStatus)
  const plcStatus = useOpenPLCStore((state): RuntimeConnection['plcStatus'] => state.runtimeConnection.plcStatus)
  const jwtToken = useOpenPLCStore((state) => state.runtimeConnection.jwtToken)
  const editingState = useOpenPLCStore((state) => state.workspace.editingState)
  const isDebuggerVisible = useOpenPLCStore((state) => state.workspace.isDebuggerVisible)

  const currentBoardInfo = availableBoards.get(deviceDefinitions.configuration.deviceBoard)
  const isSimulatorBoard = currentBoardInfo?.compiler === 'simulator'

  // Sync simulatorRunning when the simulator stops externally
  useEffect(() => {
    const unsub = simulator.onStopped(() => {
      pendingSimulatorDebugRef.current = false
      setSimulatorRunning(false)
      // Clean up debugger state if it was connected via simulator
      const { workspace, workspaceActions } = useOpenPLCStore.getState()
      if (workspace.isDebuggerVisible) {
        void debuggerPort.disconnect()
        workspaceActions.clearDebugState()
      }
    })
    return unsub
  }, [simulator, debuggerPort])

  const executeSave = useCallback(async (): Promise<boolean> => {
    const state = useOpenPLCStore.getState()
    const { workspaceActions, fileActions, editors } = state
    const activeEditor = editors[0] ?? { type: 'available', meta: { name: '' } }
    try {
      workspaceActions.setEditingState('save-request')
      const payload = prepareSavePayload({
        projectPath: projectMeta.path,
        projectData,
        deviceConfiguration: deviceDefinitions.configuration,
        devicePinMapping: deviceDefinitions.pinMapping.pins,
        editors,
        activeEditor,
      })
      const res = await projectPort.saveProject(payload)
      if (res.success) {
        workspaceActions.setEditingState('saved')
        fileActions.setAllToSaved()
        return true
      }
      workspaceActions.setEditingState('unsaved')
      addLog({ id: crypto.randomUUID(), level: 'error', message: `Save failed: ${res.error ?? 'Unknown error'}` })
      return false
    } catch {
      workspaceActions.setEditingState('unsaved')
      return false
    }
  }, [projectPort, projectMeta, projectData, deviceDefinitions, addLog])

  const handleBuild = useCallback(async () => {
    if (isCompiling) return

    // Save before compile if there are unsaved changes
    if (editingState === 'unsaved') {
      const saved = await executeSave()
      if (!saved) return
    }

    setIsCompiling(true)
    addLog({ id: crypto.randomUUID(), level: 'info', message: 'Build process started' })

    try {
      const boardTarget = deviceDefinitions.configuration.deviceBoard
      const projectPath = projectMeta.path
      const runtimeIpAddress = deviceDefinitions.configuration.runtimeIpAddress || null
      const runtimeJwtToken = jwtToken || null

      const result = await compiler.compileProgram(
        {
          projectData,
          boardTarget,
          projectPath,
          compileOnly: deviceDefinitions.configuration.compileOnly,
          isSimulator: isSimulatorBoard,
          runtimeIpAddress,
          runtimeJwtToken,
        },
        (event) => {
          // Forward plcStatus updates to device store
          if (event.plcStatus) {
            useOpenPLCStore
              .getState()
              .deviceActions.setPlcRuntimeStatus(event.plcStatus as NonNullable<RuntimeConnection['plcStatus']>)
          }

          logCompilerEvent(event, addLog)
          if (event.firmwarePath && isSimulatorBoard) {
            void simulator.loadFirmware(event.firmwarePath).then((loadResult) => {
              if (loadResult.success) {
                setSimulatorRunning(true)
                addLog({ id: crypto.randomUUID(), level: 'info', message: 'Simulator is running.' })
                if (pendingSimulatorDebugRef.current) {
                  pendingSimulatorDebugRef.current = false
                  void connectDebuggerAfterBuild()
                }
              } else {
                pendingSimulatorDebugRef.current = false
                addLog({
                  id: crypto.randomUUID(),
                  level: 'error',
                  message: `Failed to start simulator: ${loadResult.error ?? 'Unknown error'}`,
                })
              }
            })
          }
        },
      )

      if (!result.success) {
        addLog({
          id: crypto.randomUUID(),
          level: 'error',
          message: result.error ?? 'Compilation failed',
        })
      }
    } catch (err: unknown) {
      addLog({
        id: crypto.randomUUID(),
        level: 'error',
        message: `Build error: ${getErrorMessage(err)}`,
      })
    } finally {
      setIsCompiling(false)
    }
  }, [
    compiler,
    projectData,
    projectMeta,
    deviceDefinitions,
    isSimulatorBoard,
    simulator,
    addLog,
    isCompiling,
    editingState,
    executeSave,
    jwtToken,
  ])

  const handleBuildRef = useRef(handleBuild)
  handleBuildRef.current = handleBuild

  // ---------------------------------------------------------------------------
  // connectDebuggerAfterBuild — shared by simulator Start and debugger flows
  // ---------------------------------------------------------------------------

  const connectDebuggerAfterBuild = async (config?: DebugConnectionConfig) => {
    const { project, workspaceActions, consoleActions: logActions } = useOpenPLCStore.getState()
    const boardTarget = deviceDefinitions.configuration.deviceBoard
    const projectPath = project.meta.path

    const debugConfig = config ?? { connectionType: 'simulator' as const, connectionParams: {} }

    logActions.addLog({ id: crypto.randomUUID(), level: 'info', message: 'Connecting debugger...' })

    try {
      // Read debug file
      const debugFileResult = await debuggerPort.readDebugFile(projectPath, boardTarget)
      if (!debugFileResult.success || !debugFileResult.content) {
        logActions.addLog({
          id: crypto.randomUUID(),
          level: 'error',
          message: `Failed to read debug file: ${debugFileResult.error ?? 'No content'}`,
        })
        return
      }

      workspaceActions.setDebugCContent(debugFileResult.content)

      // Parse debug file and build variable maps
      const parsed = parseDebugFile(debugFileResult.content)
      const instances = project.data.configurations.resource.instances

      // Build variable index map
      const { indexMap, warnings } = buildVariableIndexMap(project.data.pous, instances, parsed)
      for (const w of warnings) {
        logActions.addLog({ id: crypto.randomUUID(), level: 'warning', message: w })
      }

      // Build debug variable tree
      let treeMap = new Map<string, DebugTreeNode>()
      try {
        const treeResult = buildDebugVariableTreeMap(
          project.data.pous,
          instances,
          parsed.variables,
          project.data,
        )
        treeMap = treeResult.treeMap

        logActions.addLog({
          id: crypto.randomUUID(),
          level: 'info',
          message: `Debug tree builder: Built ${treeResult.trees.length} trees (${treeResult.complexCount} complex).`,
        })
      } catch {
        logActions.addLog({
          id: crypto.randomUUID(),
          level: 'warning',
          message: 'Debug tree builder encountered errors.',
        })
      }

      // Build FB instance map
      const fbDebugInstancesMap = buildFbInstanceMap(project.data.pous, instances)

      const fbTypesCount = fbDebugInstancesMap.size
      const totalFbInstances = Array.from(fbDebugInstancesMap.values()).reduce((sum, list) => sum + list.length, 0)
      if (fbTypesCount > 0) {
        logActions.addLog({
          id: crypto.randomUUID(),
          level: 'info',
          message: `FB instance map: Found ${totalFbInstances} instances across ${fbTypesCount} FB types.`,
        })
      }

      // Connect debugger
      const connectResult = await debuggerPort.connect(debugConfig)
      if (!connectResult.success) {
        logActions.addLog({
          id: crypto.randomUUID(),
          level: 'error',
          message: `Debugger connection failed: ${connectResult.error ?? 'Unknown error'}`,
        })
        return
      }

      // Store debug artifacts in workspace
      workspaceActions.setDebugVariableIndexes(indexMap)
      workspaceActions.setDebugVariableTree(treeMap)
      workspaceActions.setFbDebugInstances(fbDebugInstancesMap)

      // Set default selected instance for each FB type
      fbDebugInstancesMap.forEach((instanceList, fbTypeName) => {
        if (instanceList.length > 0) {
          workspaceActions.setFbSelectedInstance(fbTypeName, instanceList[0].key)
        }
      })

      // Set target IP for non-simulator connections
      if (debugConfig.connectionType !== 'simulator' && debugConfig.connectionParams.ipAddress) {
        workspaceActions.setDebuggerTargetIp(debugConfig.connectionParams.ipAddress)
      }

      workspaceActions.setDebuggerVisible(true)
      logActions.addLog({
        id: crypto.randomUUID(),
        level: 'info',
        message: `Debugger connected. Found ${indexMap.size} debug variables.`,
      })
    } catch (err: unknown) {
      logActions.addLog({
        id: crypto.randomUUID(),
        level: 'error',
        message: `Debugger error: ${getErrorMessage(err)}`,
      })
    }
  }

  // ---------------------------------------------------------------------------
  // PLC control (Start/Stop for runtime targets)
  // ---------------------------------------------------------------------------

  const handlePlcControl = useCallback(async (): Promise<void> => {
    if (!jwtToken || connectionStatus !== 'connected') return

    try {
      if (plcStatus === 'RUNNING') {
        const result = await runtime.stopPlc()
        if (!result.success) {
          addLog({
            id: crypto.randomUUID(),
            level: 'error',
            message: `Failed to stop PLC: ${result.error ?? 'Unknown error'}`,
          })
          return
        }
      } else {
        const result = await runtime.startPlc()
        if (!result.success) {
          addLog({
            id: crypto.randomUUID(),
            level: 'error',
            message: `Failed to start PLC: ${result.error ?? 'Unknown error'}`,
          })
          return
        }
      }

      const statusResult = await runtime.getStatus()
      if (statusResult.success && statusResult.status) {
        useOpenPLCStore
          .getState()
          .deviceActions.setPlcRuntimeStatus(statusResult.status as NonNullable<RuntimeConnection['plcStatus']>)
      }
    } catch (error: unknown) {
      addLog({
        id: crypto.randomUUID(),
        level: 'error',
        message: `PLC control error: ${getErrorMessage(error)}`,
      })
    }
  }, [runtime, jwtToken, connectionStatus, plcStatus, addLog])

  // ---------------------------------------------------------------------------
  // Simulator control (Start/Stop simulator + auto-debug)
  // ---------------------------------------------------------------------------

  const handleSimulatorControl = useCallback(async (): Promise<void> => {
    try {
      if (simulatorRunning) {
        // Stop: disconnect debugger first, then stop simulator
        const { workspace, workspaceActions } = useOpenPLCStore.getState()
        if (workspace.isDebuggerVisible) {
          await debuggerPort.disconnect()
          workspaceActions.clearDebugState()
        }
        await simulator.stop()
        setSimulatorRunning(false)
        addLog({ id: crypto.randomUUID(), level: 'info', message: 'Simulator stopped.' })
      } else {
        // Start: build, load firmware, then auto-connect debugger
        pendingSimulatorDebugRef.current = true
        handleBuildRef.current().catch(() => {
          pendingSimulatorDebugRef.current = false
        })
      }
    } catch (error: unknown) {
      pendingSimulatorDebugRef.current = false
      addLog({
        id: crypto.randomUUID(),
        level: 'error',
        message: `Simulator control error: ${getErrorMessage(error)}`,
      })
    }
  }, [simulator, debuggerPort, simulatorRunning, addLog])

  // ---------------------------------------------------------------------------
  // handleMd5Verification — runs after debug compilation for non-simulator
  // ---------------------------------------------------------------------------

  const handleMd5Verification = async (
    projectPath: string,
    boardTarget: string,
    debugConfig: DebugConnectionConfig,
    isRuntimeTarget: boolean,
  ) => {
    const targetIpAddress = debugConfig.connectionParams.ipAddress
    const { consoleActions, runtimeConnection, deviceActions } = useOpenPLCStore.getState()

    try {
      // If runtime target + PLC stopped, offer to start
      if (isRuntimeTarget) {
        const currentPlcStatus = runtimeConnection.plcStatus
        const currentJwtToken = runtimeConnection.jwtToken

        if (currentPlcStatus === 'STOPPED' && currentJwtToken) {
          const response = await showDebuggerMessage(
            'question',
            'PLC Stopped',
            'The PLC is currently stopped. The debugger requires the PLC to be running. Would you like to start the PLC now?',
            ['Yes', 'No'],
          )

          if (response === 1) {
            consoleActions.addLog({ id: crypto.randomUUID(), level: 'info', message: 'Debugger session cancelled.' })
            setIsDebuggerProcessing(false)
            return
          }

          consoleActions.addLog({ id: crypto.randomUUID(), level: 'info', message: 'Starting PLC...' })

          const startResult = await runtime.startPlc()
          if (!startResult.success) {
            consoleActions.addLog({
              id: crypto.randomUUID(),
              level: 'error',
              message: `Failed to start PLC: ${startResult.error || 'Unknown error'}`,
            })
            await showDebuggerMessage(
              'error',
              'Start PLC Failed',
              `Could not start the PLC: ${startResult.error || 'Unknown error'}`,
              ['OK'],
            )
            setIsDebuggerProcessing(false)
            return
          }

          deviceActions.setPlcRuntimeStatus('RUNNING')
          consoleActions.addLog({
            id: crypto.randomUUID(),
            level: 'info',
            message: 'PLC started successfully. Waiting 2 seconds...',
          })

          await new Promise((resolve) => setTimeout(resolve, 2000))
        }
      }

      // Extract MD5 from compiled program
      consoleActions.addLog({
        id: crypto.randomUUID(),
        level: 'info',
        message: 'Extracting MD5 from compiled program...',
      })

      const programStResult = await debuggerPort.readProgramMd5(projectPath, boardTarget)

      if (!programStResult.success || !programStResult.md5) {
        consoleActions.addLog({
          id: crypto.randomUUID(),
          level: 'error',
          message: `Failed to extract MD5: ${programStResult.error ?? 'Unknown error'}`,
        })

        await showDebuggerMessage(
          'error',
          'MD5 Extraction Failed',
          programStResult.error ?? 'Could not extract MD5 from program.st',
          ['OK'],
        )
        setIsDebuggerProcessing(false)
        return
      }

      const expectedMd5 = programStResult.md5
      consoleActions.addLog({
        id: crypto.randomUUID(),
        level: 'info',
        message: `Program MD5: ${expectedMd5}`,
      })

      const targetDisplay =
        debugConfig.connectionType === 'simulator'
          ? 'simulator'
          : debugConfig.connectionType === 'tcp' || debugConfig.connectionType === 'websocket'
            ? targetIpAddress
            : debugConfig.connectionParams.port
      consoleActions.addLog({
        id: crypto.randomUUID(),
        level: 'info',
        message: `Requesting MD5 from target at ${targetDisplay}...`,
      })

      // Verify MD5 against target
      const verifyResult = await debuggerPort.verifyMd5(expectedMd5, debugConfig)

      if (!verifyResult.success) {
        consoleActions.addLog({
          id: crypto.randomUUID(),
          level: 'error',
          message: `MD5 verification failed: ${verifyResult.error ?? 'Unknown error'}`,
        })

        await showDebuggerMessage(
          'error',
          'Connection Error',
          `Could not verify MD5 with target: ${verifyResult.error ?? 'Unknown error'}`,
          ['OK'],
        )
        setIsDebuggerProcessing(false)
        return
      }

      if (verifyResult.match) {
        consoleActions.addLog({
          id: crypto.randomUUID(),
          level: 'info',
          message: 'MD5 verification successful. Starting debugger...',
        })

        await connectDebuggerAfterBuild(debugConfig)
        setIsDebuggerProcessing(false)
      } else {
        consoleActions.addLog({
          id: crypto.randomUUID(),
          level: 'warning',
          message: `MD5 mismatch. Target: ${verifyResult.targetMd5}, Expected: ${expectedMd5}`,
        })

        const response = await showDebuggerMessage(
          'warning',
          'Program Mismatch',
          'The program running on the target does not match the program opened in the editor. Would you like to upload the current project to the target?',
          ['Yes', 'No'],
        )

        if (response === 0) {
          consoleActions.addLog({
            id: crypto.randomUUID(),
            level: 'info',
            message: 'Uploading program to target...',
          })

          // Recompile with upload (compileOnly=false)
          try {
            const runtimeIpAddress = deviceDefinitions.configuration.runtimeIpAddress || null
            const runtimeJwtToken = useOpenPLCStore.getState().runtimeConnection.jwtToken || null

            const compileResult = await compiler.compileProgram(
              {
                projectData,
                boardTarget,
                projectPath,
                compileOnly: false,
                isSimulator: false,
                runtimeIpAddress,
                runtimeJwtToken,
              },
              (event) => logCompilerEvent(event, consoleActions.addLog),
            )

            if (compileResult.success) {
              consoleActions.addLog({
                id: crypto.randomUUID(),
                level: 'info',
                message: 'Upload completed. Restarting debugger verification...',
              })

              // Wait 2 seconds then re-verify
              await new Promise((resolve) => setTimeout(resolve, 2000))
              void handleMd5Verification(projectPath, boardTarget, debugConfig, isRuntimeTarget)
            } else {
              consoleActions.addLog({
                id: crypto.randomUUID(),
                level: 'error',
                message: `Upload failed: ${compileResult.error ?? 'Unknown error'}`,
              })
              setIsDebuggerProcessing(false)
            }
          } catch (err: unknown) {
            consoleActions.addLog({
              id: crypto.randomUUID(),
              level: 'error',
              message: `Upload error: ${getErrorMessage(err)}`,
            })
            setIsDebuggerProcessing(false)
          }
        } else {
          consoleActions.addLog({
            id: crypto.randomUUID(),
            level: 'info',
            message: 'Debugger session cancelled.',
          })
          setIsDebuggerProcessing(false)
        }
      }
    } catch (error: unknown) {
      consoleActions.addLog({
        id: crypto.randomUUID(),
        level: 'error',
        message: `Unexpected error during MD5 verification: ${getErrorMessage(error)}`,
      })
      setIsDebuggerProcessing(false)
    }
  }

  // ---------------------------------------------------------------------------
  // handleDebuggerClick — full debugger orchestration for non-simulator targets
  // ---------------------------------------------------------------------------

  const handleDebuggerClick = useCallback(async () => {
    // Simulator target uses the unified Start/Stop flow instead
    if (isSimulatorBoard) return

    const { workspace, project, deviceDefinitions: devDefs, workspaceActions, consoleActions, deviceActions } =
      useOpenPLCStore.getState()

    if (workspace.isDebuggerVisible) {
      await debuggerPort.disconnect()
      workspaceActions.setDebuggerTargetIp(null)
      workspaceActions.setDebugForcedVariables(new Map())
      workspaceActions.clearFbDebugContext()
      workspaceActions.setDebuggerVisible(false)
      return
    }

    if (isDebuggerProcessing) return
    setIsDebuggerProcessing(true)

    try {
      // Save if unsaved
      if (editingState === 'unsaved') {
        const saved = await executeSave()
        if (!saved) {
          setIsDebuggerProcessing(false)
          return
        }
      }

      const boardTarget = devDefs.configuration.deviceBoard
      const projectPath = project.meta.path
      const boardInfo = availableBoards.get(boardTarget)
      const isRuntimeTarget = isOpenPLCRuntimeTarget(boardInfo)
      const isRuntimeV4 = isOpenPLCRuntimeV4Target(boardTarget)

      let targetIpAddress: string | undefined
      let debugConfig: DebugConnectionConfig = { connectionType: 'tcp', connectionParams: {} }

      if (isRuntimeTarget) {
        // Runtime target: require connection
        const runtimeConnectionStatus = useOpenPLCStore.getState().runtimeConnection.connectionStatus
        const runtimeIpAddress = devDefs.configuration.runtimeIpAddress

        if (runtimeConnectionStatus !== 'connected' || !runtimeIpAddress) {
          await showDebuggerMessage(
            'warning',
            'Connection Required',
            'You need to connect to the target before starting a debugger session.',
            ['OK'],
          )
          setIsDebuggerProcessing(false)
          return
        }

        targetIpAddress = runtimeIpAddress

        if (isRuntimeV4) {
          const currentJwtToken = useOpenPLCStore.getState().runtimeConnection.jwtToken || undefined
          if (!currentJwtToken) {
            await showDebuggerMessage(
              'error',
              'Authentication Required',
              'JWT token is missing. Please reconnect to the runtime.',
              ['OK'],
            )
            setIsDebuggerProcessing(false)
            return
          }
          debugConfig = {
            connectionType: 'websocket',
            connectionParams: { ipAddress: runtimeIpAddress, jwtToken: currentJwtToken },
          }
        } else {
          debugConfig = {
            connectionType: 'tcp',
            connectionParams: { ipAddress: runtimeIpAddress },
          }
        }
      } else {
        // Embedded hardware: determine TCP or RTU
        const { modbusTCP, modbusRTU, communicationPreferences } = devDefs.configuration.communicationConfiguration
        const rtuEnabled = communicationPreferences.enabledRTU
        const tcpEnabled = communicationPreferences.enabledTCP

        if (!rtuEnabled && !tcpEnabled) {
          await showDebuggerMessage(
            'warning',
            'Modbus Required',
            'Modbus must be enabled on the target to start a debugger session.',
            ['OK'],
          )
          setIsDebuggerProcessing(false)
          return
        }

        let useModbusTcp = false

        if (rtuEnabled && tcpEnabled) {
          const response = await showDebuggerMessage(
            'question',
            'Select Modbus Protocol',
            'Both Modbus RTU and Modbus TCP are enabled. Which would you like to use?',
            ['Modbus RTU (Serial)', 'Modbus TCP'],
          )
          useModbusTcp = response === 1
        } else {
          useModbusTcp = tcpEnabled
        }

        if (useModbusTcp) {
          const dhcpEnabled = communicationPreferences.enabledDHCP

          if (dhcpEnabled) {
            const previousIp = useOpenPLCStore.getState().deviceDefinitions.temporaryDhcpIp || ''
            const result = await showDebuggerIpInput(
              'Target IP Address',
              'Enter the IP address of the target device:',
              previousIp,
            )

            if (result === null || !result) {
              setIsDebuggerProcessing(false)
              return
            }

            targetIpAddress = result
            deviceActions.setTemporaryDhcpIp(targetIpAddress)
          } else {
            targetIpAddress = modbusTCP.tcpStaticHostConfiguration.ipAddress || undefined

            if (!targetIpAddress) {
              await showDebuggerMessage('error', 'Configuration Error', 'No IP address configured for Modbus TCP.', [
                'OK',
              ])
              setIsDebuggerProcessing(false)
              return
            }
          }

          debugConfig = {
            connectionType: 'tcp',
            connectionParams: { ipAddress: targetIpAddress },
          }
        } else {
          // Modbus RTU
          const rtuPort = devDefs.configuration.communicationPort
          const rtuBaudRate = parseInt(modbusRTU.rtuBaudRate, 10)
          const rtuSlaveId = modbusRTU.rtuSlaveId ?? undefined

          if (!rtuPort) {
            await showDebuggerMessage(
              'error',
              'Configuration Error',
              'No communication port selected for Modbus RTU.',
              ['OK'],
            )
            setIsDebuggerProcessing(false)
            return
          }

          if (rtuSlaveId === undefined) {
            await showDebuggerMessage('error', 'Configuration Error', 'No slave ID configured for Modbus RTU.', ['OK'])
            setIsDebuggerProcessing(false)
            return
          }

          consoleActions.addLog({
            id: crypto.randomUUID(),
            level: 'info',
            message: `Using Modbus RTU: Port=${rtuPort}, Baud=${rtuBaudRate}, SlaveID=${rtuSlaveId}`,
          })

          debugConfig = {
            connectionType: 'rtu',
            connectionParams: { port: rtuPort, baudRate: rtuBaudRate, slaveId: rtuSlaveId },
          }
        }
      }

      // Run debug compilation
      consoleActions.addLog({
        id: crypto.randomUUID(),
        level: 'info',
        message: 'Starting debug compilation...',
      })

      const debugCompileResult = await compiler.compileForDebug(
        { projectData, boardTarget, projectPath },
        (event) => logCompilerEvent(event, consoleActions.addLog),
      )

      if (!debugCompileResult.success) {
        consoleActions.addLog({
          id: crypto.randomUUID(),
          level: 'error',
          message: `Debug compilation failed: ${debugCompileResult.error ?? 'Unknown error'}`,
        })
        setIsDebuggerProcessing(false)
        return
      }

      // Proceed to MD5 verification
      void handleMd5Verification(projectPath, boardTarget, debugConfig, isRuntimeTarget)
    } catch (error: unknown) {
      consoleActions.addLog({
        id: crypto.randomUUID(),
        level: 'error',
        message: `Error during debugger initialization: ${getErrorMessage(error)}`,
      })
      setIsDebuggerProcessing(false)
    }
  }, [
    debuggerPort,
    runtime,
    compiler,
    projectData,
    deviceDefinitions,
    projectMeta,
    availableBoards,
    isSimulatorBoard,
    isDebuggerProcessing,
    editingState,
    executeSave,
    addLog,
  ])

  return (
    <>
      <TooltipSidebarWrapperButton tooltipContent='Search'>
        <SearchButton />
      </TooltipSidebarWrapperButton>
      <TooltipSidebarWrapperButton tooltipContent='Open/Close Toolbox'>
        <ZoomButton {...zoom} />
      </TooltipSidebarWrapperButton>
      <TooltipSidebarWrapperButton tooltipContent={isSimulatorBoard ? 'Use Start to build and run' : 'Compile'}>
        <DownloadButton
          disabled={isCompiling || isSimulatorBoard}
          className={cn((isCompiling || isSimulatorBoard) && disabledButtonClass)}
          onClick={() => void handleBuild()}
        />
      </TooltipSidebarWrapperButton>
      <TooltipSidebarWrapperButton
        tooltipContent={
          isSimulatorBoard
            ? simulatorRunning
              ? 'Stop Simulator'
              : 'Start Simulator'
            : connectionStatus !== 'connected'
              ? 'Connect to runtime first'
              : plcStatus === 'RUNNING'
                ? 'Stop PLC'
                : 'Start PLC'
        }
      >
        <PlayButton
          onClick={isSimulatorBoard ? () => void handleSimulatorControl() : () => void handlePlcControl()}
          disabled={isSimulatorBoard ? isCompiling || isDebuggerProcessing : connectionStatus !== 'connected'}
          className={cn(
            isSimulatorBoard
              ? isCompiling || isDebuggerProcessing
                ? disabledButtonClass
                : ''
              : connectionStatus !== 'connected'
                ? disabledButtonClass
                : '',
          )}
        >
          {(isSimulatorBoard ? simulatorRunning : plcStatus === 'RUNNING') ? <StopIcon /> : null}
        </PlayButton>
      </TooltipSidebarWrapperButton>
      <TooltipSidebarWrapperButton tooltipContent={isSimulatorBoard ? 'Use Start to debug' : 'Debugger'}>
        <DebuggerButton
          onClick={() => void handleDebuggerClick()}
          disabled={isDebuggerProcessing || isSimulatorBoard}
          isActive={isDebuggerVisible}
          className={cn((isDebuggerProcessing || isSimulatorBoard) && disabledButtonClass)}
        />
      </TooltipSidebarWrapperButton>
      <ChatButton />
    </>
  )
}
