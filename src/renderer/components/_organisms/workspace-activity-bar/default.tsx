import { StopIcon } from '@root/renderer/assets'
import { compileOnlySelectors } from '@root/renderer/hooks'
import { useOpenPLCStore } from '@root/renderer/store'
import type { RuntimeConnection } from '@root/renderer/store/slices/device/types'
import { matchVariableWithDebugEntry, parseDebugFile } from '@root/renderer/utils/parse-debug-file'
import { PLCPou, PLCProjectData } from '@root/types/PLC/open-plc'
import { BufferToStringArray, cn } from '@root/utils'
import { addCppLocalVariables } from '@root/utils/cpp/addCppLocalVariables'
import { generateSTCode as generateCppSTCode } from '@root/utils/cpp/generateSTCode'
import { validateCppCode } from '@root/utils/cpp/validateCppCode'

type CppPouData = {
  name: string
  code: string
  variables: unknown[]
}

type ProjectDataWithCpp = PLCProjectData & {
  originalCppPous?: CppPouData[]
}
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
  const [isDebuggerProcessing, setIsDebuggerProcessing] = useState(false)

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

    const hasCppCode = processedProjectData.pous.some((pou: PLCPou) => pou.data.body.language === 'cpp')

    if (hasCppCode) {
      const cppPous = processedProjectData.pous.filter((pou: PLCPou) => pou.data.body.language === 'cpp')

      cppPous.forEach((pou) => {
        addLog({
          id: crypto.randomUUID(),
          level: 'info',
          message: `Found C/C++ POU: "${pou.data.name}" (${pou.type})`,
        })
      })

      addLog({
        id: crypto.randomUUID(),
        level: 'info',
        message: `Processing ${cppPous.length} C/C++ POU(s)...`,
      })

      let validationFailed = false
      for (const pou of cppPous) {
        const code = pou.data.body.language === 'cpp' ? (pou.data.body as { value: string }).value : ''
        const validation = validateCppCode(code)
        if (!validation.valid) {
          addLog({
            id: crypto.randomUUID(),
            level: 'error',
            message: `Validation failed for "${pou.data.name}": ${validation.error}`,
          })
          validationFailed = true
        }
      }

      if (validationFailed) {
        setIsCompiling(false)
        return
      }

      processedProjectData = addCppLocalVariables(processedProjectData)

      const originalCppPousData = cppPous.map((pou) => ({
        name: pou.data.name,
        code: pou.data.body.language === 'cpp' ? (pou.data.body as { value: string }).value : '',
        variables: pou.data.variables,
      }))

      processedProjectData.pous = processedProjectData.pous.map((pou: PLCPou) => {
        if (pou.data.body.language === 'cpp') {
          const stCode = generateCppSTCode({
            pouName: pou.data.name,
            allVariables: pou.data.variables,
          })

          pou.data.body = {
            language: 'st',
            value: stCode,
          }
        }
        return pou
      })

      const projectDataWithCpp = processedProjectData as ProjectDataWithCpp
      projectDataWithCpp.originalCppPous = originalCppPousData

      addLog({
        id: crypto.randomUUID(),
        level: 'info',
        message: `Successfully processed ${cppPous.length} C/C++ POU(s)`,
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
        processedProjectData as ProjectDataWithCpp,
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

  const handleDebuggerClick = async () => {
    const { workspace, project, deviceDefinitions, workspaceActions, consoleActions, deviceActions } =
      useOpenPLCStore.getState()

    if (workspace.isDebuggerVisible) {
      const _disconnectResult: { success: boolean } = await window.bridge.debuggerDisconnect()
      workspaceActions.setDebuggerVisible(false)
      workspaceActions.setDebuggerTargetIp(null)
      return
    }

    if (isDebuggerProcessing) {
      return
    }

    setIsDebuggerProcessing(true)

    try {
      if (editingState === 'unsaved') {
        await saveProject({ data: projectData, meta: projectMeta }, deviceDefinitions)
      }

      const boardTarget = deviceDefinitions.configuration.deviceBoard
      const projectPath = project.meta.path
      const onlyCompileBoards = ['OpenPLC Runtime v3', 'OpenPLC Runtime v4', 'Raspberry Pi']
      const isRuntimeTarget = onlyCompileBoards.includes(boardTarget)
      const isRuntimeV4 = boardTarget === 'OpenPLC Runtime v4'

      let targetIpAddress: string | undefined
      let connectionType: 'tcp' | 'rtu' | 'websocket' = 'tcp'
      let rtuPort: string | undefined
      let rtuBaudRate: number | undefined
      let rtuSlaveId: number | undefined
      let jwtToken: string | undefined

      if (isRuntimeTarget) {
        const connectionStatus = useOpenPLCStore.getState().runtimeConnection.connectionStatus
        const runtimeIpAddress = deviceDefinitions.configuration.runtimeIpAddress

        if (connectionStatus !== 'connected' || !runtimeIpAddress) {
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
          connectionType = 'websocket'
          jwtToken = useOpenPLCStore.getState().runtimeConnection.jwtToken || undefined
          if (!jwtToken) {
            await showDebuggerMessage(
              'error',
              'Authentication Required',
              'JWT token is missing. Please reconnect to the runtime.',
              ['OK'],
            )
            setIsDebuggerProcessing(false)
            return
          }
        }
      } else {
        const { modbusTCP, communicationPreferences } = deviceDefinitions.configuration.communicationConfiguration
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
            const previousIp = deviceDefinitions.temporaryDhcpIp || ''
            const result = await showDebuggerIpInput(
              'Target IP Address',
              'Enter the IP address of the target device:',
              previousIp,
            )

            if (result === null) {
              setIsDebuggerProcessing(false)
              return
            }

            targetIpAddress = result
            if (!targetIpAddress) {
              setIsDebuggerProcessing(false)
              return
            }

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
        } else {
          const { modbusRTU } = deviceDefinitions.configuration.communicationConfiguration
          connectionType = 'rtu'

          rtuPort = deviceDefinitions.configuration.communicationPort
          rtuBaudRate = parseInt(modbusRTU.rtuBaudRate, 10)
          rtuSlaveId = modbusRTU.rtuSlaveId ?? undefined

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
        }
      }

      consoleActions.addLog({
        id: crypto.randomUUID(),
        level: 'info',
        message: 'Starting debug compilation...',
      })

      const hasPythonCode = projectData.pous.some((pou: PLCPou) => pou.data.body.language === 'python')
      let processedProjectData: PLCProjectData = projectData

      if (hasPythonCode) {
        const pythonPous = projectData.pous.filter((pou: PLCPou) => pou.data.body.language === 'python')

        pythonPous.forEach((pou) => {
          consoleActions.addLog({
            id: crypto.randomUUID(),
            level: 'info',
            message: `Found Python POU: "${pou.data.name}" (${pou.type})`,
          })
        })

        consoleActions.addLog({
          id: crypto.randomUUID(),
          level: 'info',
          message: `Processing ${pythonPous.length} Python POU(s)...`,
        })

        processedProjectData = addPythonLocalVariables(projectData)

        const pythonData = extractPythonData(processedProjectData.pous)
        const processedPythonCodes = injectPythonCode(pythonData)

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

        consoleActions.addLog({
          id: crypto.randomUUID(),
          level: 'info',
          message: `Successfully processed ${processedPythonCodes.length} Python POU(s)`,
        })
      }

      const hasCppCode = processedProjectData.pous.some((pou: PLCPou) => pou.data.body.language === 'cpp')

      if (hasCppCode) {
        const cppPous = processedProjectData.pous.filter((pou: PLCPou) => pou.data.body.language === 'cpp')

        cppPous.forEach((pou) => {
          consoleActions.addLog({
            id: crypto.randomUUID(),
            level: 'info',
            message: `Found C/C++ POU: "${pou.data.name}" (${pou.type})`,
          })
        })

        consoleActions.addLog({
          id: crypto.randomUUID(),
          level: 'info',
          message: `Processing ${cppPous.length} C/C++ POU(s)...`,
        })

        let validationFailed = false
        for (const pou of cppPous) {
          const code = pou.data.body.language === 'cpp' ? (pou.data.body as { value: string }).value : ''
          const validation = validateCppCode(code)
          if (!validation.valid) {
            consoleActions.addLog({
              id: crypto.randomUUID(),
              level: 'error',
              message: `Validation failed for "${pou.data.name}": ${validation.error}`,
            })
            validationFailed = true
          }
        }

        if (validationFailed) {
          setIsDebuggerProcessing(false)
          return
        }

        processedProjectData = addCppLocalVariables(processedProjectData)

        const originalCppPousData = cppPous.map((pou) => ({
          name: pou.data.name,
          code: pou.data.body.language === 'cpp' ? (pou.data.body as { value: string }).value : '',
          variables: pou.data.variables,
        }))

        processedProjectData.pous = processedProjectData.pous.map((pou: PLCPou) => {
          if (pou.data.body.language === 'cpp') {
            const stCode = generateCppSTCode({
              pouName: pou.data.name,
              allVariables: pou.data.variables,
            })

            pou.data.body = {
              language: 'st',
              value: stCode,
            }
          }
          return pou
        })

        const projectDataWithCpp = processedProjectData as ProjectDataWithCpp
        projectDataWithCpp.originalCppPous = originalCppPousData

        consoleActions.addLog({
          id: crypto.randomUUID(),
          level: 'info',
          message: `Successfully processed ${cppPous.length} C/C++ POU(s)`,
        })
      }

      window.bridge.runDebugCompilation(
        [projectPath, boardTarget, processedProjectData as ProjectDataWithCpp],
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
            void handleMd5Verification(
              projectPath,
              boardTarget,
              connectionType,
              {
                ipAddress: targetIpAddress,
                port: rtuPort,
                baudRate: rtuBaudRate,
                slaveId: rtuSlaveId,
                jwtToken,
              },
              targetIpAddress,
              isRuntimeTarget,
            )
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

  const handleMd5Verification = async (
    projectPath: string,
    boardTarget: string,
    connectionType: 'tcp' | 'rtu' | 'websocket',
    connectionParams: {
      ipAddress?: string
      port?: string
      baudRate?: number
      slaveId?: number
      jwtToken?: string
    },
    targetIpAddress: string | undefined,
    isRuntimeTarget: boolean,
  ) => {
    const { consoleActions, workspaceActions, runtimeConnection, deviceActions } = useOpenPLCStore.getState()

    try {
      if (isRuntimeTarget) {
        const plcStatus = runtimeConnection.plcStatus
        const jwtToken = runtimeConnection.jwtToken

        if (plcStatus === 'STOPPED' && jwtToken) {
          const response = await showDebuggerMessage(
            'question',
            'PLC Stopped',
            'The PLC is currently stopped. The debugger requires the PLC to be running. Would you like to start the PLC now?',
            ['Yes', 'No'],
          )

          if (response === 1) {
            consoleActions.addLog({
              id: crypto.randomUUID(),
              level: 'info',
              message: 'Debugger session cancelled.',
            })
            setIsDebuggerProcessing(false)
            return
          }

          consoleActions.addLog({
            id: crypto.randomUUID(),
            level: 'info',
            message: 'Starting PLC...',
          })

          const startResult = await window.bridge.runtimeStartPlc(targetIpAddress!, jwtToken)
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
        connectionType === 'tcp' || connectionType === 'websocket' ? targetIpAddress : connectionParams.port
      consoleActions.addLog({
        id: crypto.randomUUID(),
        level: 'info',
        message: `Requesting MD5 from target at ${targetDisplay}...`,
      })

      const verifyResult = await window.bridge.debuggerVerifyMd5(connectionType, connectionParams, expectedMd5)

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

            const allVariables = pou.data.variables

            allVariables.forEach((v) => {
              const index = matchVariableWithDebugEntry(v.name, instance.name, parsed.variables)
              if (index !== null) {
                const compositeKey = `${pou.data.name}:${v.name}`
                indexMap.set(compositeKey, index)
              }
            })
          })

          parsed.variables.forEach((debugVar) => {
            if (!indexMap.has(debugVar.name)) {
              indexMap.set(debugVar.name, debugVar.index)
            }
          })

          const connectResult: { success: boolean; error?: string } = await window.bridge.debuggerConnect(
            connectionType,
            connectionParams,
          )
          if (!connectResult.success) {
            consoleActions.addLog({
              id: crypto.randomUUID(),
              level: 'error',
              message: `Failed to establish debugger connection: ${connectResult.error || 'Unknown error'}`,
            })
            setIsDebuggerProcessing(false)
            return
          }

          workspaceActions.setDebugVariableIndexes(indexMap)
          if (!isRuntimeTarget) {
            workspaceActions.setDebuggerTargetIp(targetIpAddress ?? null)
          }
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

          const boardCore = availableBoards.get(boardTarget)?.core || null
          const runtimeJwtToken = useOpenPLCStore.getState().runtimeConnection.jwtToken || null

          window.bridge.runCompileProgram(
            [projectPath, boardTarget, boardCore, false, projectData, targetIpAddress ?? '', runtimeJwtToken],
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
                  void handleMd5Verification(
                    projectPath,
                    boardTarget,
                    connectionType,
                    connectionParams,
                    targetIpAddress,
                    isRuntimeTarget,
                  )
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
