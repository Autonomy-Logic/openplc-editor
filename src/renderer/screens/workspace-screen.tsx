import { ClearConsoleButton } from '@components/_atoms/buttons/console/clear-console'
import * as Tabs from '@radix-ui/react-tabs'
import { DebugTreeNode } from '@root/types/debugger'
import { cn, isOpenPLCRuntimeTarget } from '@root/utils'
import { useEffect, useRef } from 'react'
import { useState } from 'react'
import { ImperativePanelHandle } from 'react-resizable-panels'

import { ExitIcon } from '../assets'
import { DataTypeEditor, MonacoEditor } from '../components/_features/[workspace]/editor'
import { DeviceEditor } from '../components/_features/[workspace]/editor/device'
import { GraphicalEditor } from '../components/_features/[workspace]/editor/graphical'
import { ResourcesEditor } from '../components/_features/[workspace]/editor/resource-editor'
import { Search } from '../components/_features/[workspace]/search'
import { VariablesPanel } from '../components/_molecules/variables-panel'
import AboutModal from '../components/_organisms/about-modal'
import { Console as ConsoleComponent } from '../components/_organisms/console'
import { Debugger } from '../components/_organisms/debugger'
import { Explorer } from '../components/_organisms/explorer'
import {
  ConfirmDeviceSwitchModal,
  DebuggerIpInputModal,
  DebuggerMessageModal,
  RuntimeCreateUserModal,
  RuntimeLoginModal,
} from '../components/_organisms/modals'
import { Navigation } from '../components/_organisms/navigation'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../components/_organisms/panel'
import { PlcLogs } from '../components/_organisms/plc-logs'
import { VariablesEditor } from '../components/_organisms/variables-editor'
import { WorkspaceActivityBar } from '../components/_organisms/workspace-activity-bar'
import { WorkspaceMainContent, WorkspaceSideContent } from '../components/_templates'
import { StandardFunctionBlocks } from '../data/library/standard-function-blocks'
import { useOpenPLCStore } from '../store'
import { getVariableSize, parseVariableValue } from '../utils/variable-sizes'

const DEBUGGER_POLL_INTERVAL_MS = 200
const PLC_LOGS_POLL_INTERVAL_MS = 2500

const WorkspaceScreen = () => {
  const {
    tabs,
    workspace: {
      isCollapsed,
      isDebuggerVisible,
      isPlcLogsVisible,
      debugVariableValues,
      debugVariableTree,
      expandedVisibleLeafKeys,
    },
    editor,
    workspaceActions: { toggleCollapse },
    deviceActions: { setAvailableOptions },
    searchResults,
    project: {
      data: { pous },
    },
  } = useOpenPLCStore()

  const allDebugVariables = pous.flatMap((pou) => {
    return pou.data.variables
      .filter((v) => v.debug === true)
      .map((v) => {
        let typeValue = ''
        if (v.type.definition === 'base-type') {
          typeValue = v.type.value
        } else if (v.type.definition === 'user-data-type') {
          typeValue = v.type.value
        } else if (v.type.definition === 'array') {
          typeValue = v.type.value
        } else if (v.type.definition === 'derived') {
          typeValue = v.type.value
        }

        const compositeKey = `${pou.data.name}:${v.name}`
        const variableValue = debugVariableValues.get(compositeKey)
        const displayValue = variableValue !== undefined ? variableValue : '-'

        return {
          pouName: pou.data.name,
          name: v.name,
          type: typeValue,
          value: displayValue,
        }
      })
  })

  const nameOccurrences = new Map<string, number>()
  allDebugVariables.forEach((v) => {
    nameOccurrences.set(v.name, (nameOccurrences.get(v.name) || 0) + 1)
  })

  const debugVariables = allDebugVariables.map((v) => {
    const hasConflict = nameOccurrences.get(v.name)! > 1
    const compositeKey = `${v.pouName}:${v.name}`
    return {
      name: hasConflict ? `[${v.pouName}] ${v.name}` : v.name,
      type: v.type,
      value: v.value,
      compositeKey,
    }
  })

  const watchedCompositeKeys = new Set<string>(
    pous.flatMap((pou) => pou.data.variables.filter((v) => v.debug === true).map((v) => `${pou.data.name}:${v.name}`)),
  )

  const filteredDebugVariableTree = debugVariableTree
    ? new Map<string, DebugTreeNode>(
        Array.from(debugVariableTree.entries() as Iterable<[string, DebugTreeNode]>).filter(([key]) =>
          watchedCompositeKeys.has(key),
        ),
      )
    : undefined

  const [graphList, setGraphList] = useState<string[]>([])
  const [isVariablesPanelCollapsed, setIsVariablesPanelCollapsed] = useState(false)
  const [activeTab, setActiveTab] = useState('console')

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  type VariableInfo = {
    pouName: string
    variable: (typeof pous)[0]['data']['variables'][0]
  }
  const variableInfoMapRef = useRef<Map<number, VariableInfo> | null>(null)

  useEffect(() => {
    const {
      workspace: { isDebuggerVisible, debuggerTargetIp, debugVariableIndexes },
      deviceDefinitions,
      workspaceActions,
      project,
      runtimeConnection: { connectionStatus, ipAddress: runtimeIpAddress },
      deviceAvailableOptions: { availableBoards },
    } = useOpenPLCStore.getState()

    if (!isDebuggerVisible) {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
        pollingIntervalRef.current = null
      }
      variableInfoMapRef.current = null
      return
    }

    const boardTarget = deviceDefinitions.configuration.deviceBoard
    const currentBoardInfo = availableBoards.get(boardTarget)
    const isRuntimeTarget = isOpenPLCRuntimeTarget(currentBoardInfo)
    const isRTU = deviceDefinitions.configuration.communicationConfiguration.communicationPreferences.enabledRTU
    const isTCP = deviceDefinitions.configuration.communicationConfiguration.communicationPreferences.enabledTCP

    if (isRuntimeTarget) {
      if (connectionStatus !== 'connected') {
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current)
          pollingIntervalRef.current = null
        }
        variableInfoMapRef.current = null
        return
      }

      if (!runtimeIpAddress) {
        console.warn('No runtime IP address configured')
        return
      }
    } else {
      if (isTCP && !debuggerTargetIp) {
        console.warn('No debugger target IP address configured')
        return
      }

      if (!isTCP && !isRTU) {
        console.warn('No Modbus connection configured (neither TCP nor RTU)')
        return
      }
    }
    let batchSize = 60

    if (isRTU && !isTCP) {
      batchSize = 20
    }

    const variableInfoMap = new Map<number, VariableInfo>()

    project.data.pous.forEach((pou) => {
      if (pou.type !== 'program') return

      pou.data.variables.forEach((v) => {
        const compositeKey = `${pou.data.name}:${v.name}`
        const index = debugVariableIndexes.get(compositeKey)
        if (index !== undefined) {
          variableInfoMap.set(index, { pouName: pou.data.name, variable: v })
        }
      })
    })

    const { ladderFlows } = useOpenPLCStore.getState()

    project.data.pous.forEach((pou) => {
      if (pou.type !== 'program') return

      const instances = project.data.configuration.resource.instances
      const programInstance = instances.find((inst) => inst.program === pou.data.name)

      if (programInstance) {
        const functionBlockInstances = pou.data.variables.filter((variable) => variable.type.definition === 'derived')

        const blockExecutionControlMap = new Map<string, boolean>()
        if (pou.data.body.language === 'ld') {
          const currentLadderFlow = ladderFlows.find((flow) => flow.name === pou.data.name)
          if (currentLadderFlow) {
            currentLadderFlow.rungs.forEach((rung) => {
              rung.nodes.forEach((node) => {
                if (node.type === 'block') {
                  const blockData = node.data as { variable?: { name: string }; executionControl?: boolean }
                  if (blockData.variable?.name && blockData.executionControl) {
                    blockExecutionControlMap.set(blockData.variable.name, true)
                  }
                }
              })
            })
          }
        }

        functionBlockInstances.forEach((fbInstance) => {
          const fbTypeName = fbInstance.type.value.toUpperCase()
          const hasExecutionControl = blockExecutionControlMap.get(fbInstance.name) || false

          let fbVariables:
            | Array<{ name: string; class: string; type: { definition: string; value: string } }>
            | undefined

          const standardFB = StandardFunctionBlocks.pous.find(
            (fb: { name: string }) => fb.name.toUpperCase() === fbTypeName,
          )
          if (standardFB) {
            fbVariables = standardFB.variables
          } else {
            const customFB = project.data.pous.find(
              (p) => p.type === 'function-block' && p.data.name.toUpperCase() === fbTypeName,
            )
            if (customFB && customFB.type === 'function-block') {
              fbVariables = customFB.data.variables as Array<{
                name: string
                class: string
                type: { definition: string; value: string }
              }>
            }
          }

          if (fbVariables) {
            let allBaseTypeVars = fbVariables.filter((v) => v.type.definition === 'base-type')

            if (hasExecutionControl) {
              const hasENO = allBaseTypeVars.some((v) => v.name.toUpperCase() === 'ENO')
              if (!hasENO) {
                allBaseTypeVars = [
                  ...allBaseTypeVars,
                  { name: 'ENO', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
                ]
              }
            }

            allBaseTypeVars.forEach((fbVar) => {
              const debugPath = `RES0__${programInstance.name.toUpperCase()}.${fbInstance.name.toUpperCase()}.${fbVar.name.toUpperCase()}`
              const index = debugVariableIndexes.get(debugPath)

              if (index !== undefined) {
                const blockVarName = `${fbInstance.name}.${fbVar.name}`
                variableInfoMap.set(index, {
                  pouName: pou.data.name,
                  variable: {
                    name: blockVarName,
                    type: {
                      definition: 'base-type',
                      value: fbVar.type.value.toLowerCase() as
                        | 'bool'
                        | 'int'
                        | 'real'
                        | 'time'
                        | 'string'
                        | 'date'
                        | 'sint'
                        | 'dint'
                        | 'lint'
                        | 'usint'
                        | 'uint'
                        | 'udint'
                        | 'ulint'
                        | 'lreal'
                        | 'tod'
                        | 'dt'
                        | 'byte'
                        | 'word'
                        | 'dword'
                        | 'lword',
                    },
                    class: 'local',
                    location: '',
                    documentation: '',
                    debug: false,
                  },
                })
              }
            })
          }
        })

        if (pou.data.body.language === 'ld') {
          const currentLadderFlow = ladderFlows.find((flow) => flow.name === pou.data.name)
          if (currentLadderFlow) {
            currentLadderFlow.rungs.forEach((rung) => {
              rung.nodes.forEach((node) => {
                if (node.type !== 'block') return

                const blockData = node.data as {
                  variable?: { name: string }
                  variant?: {
                    name: string
                    type: string
                    variables: Array<{ name: string; class: string; type: { definition: string; value: string } }>
                  }
                  numericId?: string
                  executionControl?: boolean
                }

                if (!blockData.variant || blockData.variant.type !== 'function') return

                const blockName = blockData.variant.name.toUpperCase()
                const numericId = blockData.numericId
                if (!numericId) return

                let boolOutputs = blockData.variant.variables.filter(
                  (v) =>
                    (v.class === 'output' || v.class === 'inOut') &&
                    v.type.definition === 'base-type' &&
                    v.type.value.toUpperCase() === 'BOOL',
                )

                const hasExecutionControl = blockData.executionControl || false
                if (hasExecutionControl) {
                  const hasENO = boolOutputs.some((v) => v.name.toUpperCase() === 'ENO')
                  if (!hasENO) {
                    boolOutputs = [
                      ...boolOutputs,
                      { name: 'ENO', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
                    ]
                  }
                }

                boolOutputs.forEach((outputVar) => {
                  const debugPath = `RES0__${programInstance.name.toUpperCase()}._TMP_${blockName}${numericId}_${outputVar.name.toUpperCase()}`
                  const index = debugVariableIndexes.get(debugPath)

                  if (index !== undefined) {
                    const tempVarName = `_TMP_${blockName}${numericId}_${outputVar.name}`
                    variableInfoMap.set(index, {
                      pouName: pou.data.name,
                      variable: {
                        name: tempVarName,
                        type: { definition: 'base-type', value: 'bool' },
                        class: 'local',
                        location: '',
                        documentation: '',
                        debug: false,
                      },
                    })
                  }
                })
              })
            })
          }
        }
      }
    })

    variableInfoMapRef.current = variableInfoMap

    const pollVariables = async () => {
      if (!isMountedRef.current) return

      if (!variableInfoMapRef.current) {
        return
      }

      try {
        const { project: currentProject } = useOpenPLCStore.getState()

        const debugVariableKeys = new Set<string>()

        currentProject.data.pous.forEach((pou) => {
          if (pou.type !== 'program') return
          pou.data.variables
            .filter((v) => v.debug === true)
            .forEach((v) => {
              debugVariableKeys.add(`${pou.data.name}:${v.name}`)
            })
        })

        const expandedVisibleLeafKeysSet = expandedVisibleLeafKeys
        for (const key of expandedVisibleLeafKeysSet) {
          debugVariableKeys.add(key)
        }

        for (const key of graphList) {
          debugVariableKeys.add(key)
        }

        const { editor, ladderFlows } = useOpenPLCStore.getState()
        const currentPou = currentProject.data.pous.find((pou) => pou.data.name === editor.meta.name)
        if (currentPou && currentPou.data.body.language === 'ld') {
          const currentLadderFlow = ladderFlows.find((flow) => flow.name === editor.meta.name)
          if (currentLadderFlow) {
            currentLadderFlow.rungs.forEach((rung) => {
              rung.nodes.forEach((node) => {
                if (node.type === 'contact' || node.type === 'coil') {
                  const nodeData = node.data as {
                    variable?: { name?: string; type?: { definition?: string; value?: string } }
                  }
                  const variableName = nodeData.variable?.name

                  if (
                    variableName &&
                    nodeData.variable?.type?.definition === 'base-type' &&
                    nodeData.variable?.type?.value?.toUpperCase() === 'BOOL'
                  ) {
                    const compositeKey = `${currentPou.data.name}:${variableName}`
                    debugVariableKeys.add(compositeKey)
                  }
                }
              })
            })
          }

          const functionBlockInstances = currentPou.data.variables.filter(
            (variable) => variable.type.definition === 'derived',
          )

          functionBlockInstances.forEach((fbInstance) => {
            Array.from(variableInfoMapRef.current!.entries()).forEach(([_, varInfo]) => {
              if (
                varInfo.pouName === currentPou.data.name &&
                varInfo.variable.name.startsWith(`${fbInstance.name}.`) &&
                varInfo.variable.type.definition === 'base-type' &&
                varInfo.variable.type.value.toLowerCase() === 'bool'
              ) {
                const compositeKey = `${varInfo.pouName}:${varInfo.variable.name}`
                debugVariableKeys.add(compositeKey)
              }
            })
          })

          const instances = currentProject.data.configuration.resource.instances
          const programInstance = instances.find((inst) => inst.program === currentPou.data.name)
          if (programInstance && currentLadderFlow) {
            currentLadderFlow.rungs.forEach((rung) => {
              rung.nodes.forEach((node) => {
                if (node.type === 'block') {
                  const blockData = node.data as {
                    variant?: { type: string }
                    numericId?: string
                  }

                  if (blockData.variant?.type === 'function' && blockData.numericId) {
                    Array.from(variableInfoMapRef.current!.entries()).forEach(([_, varInfo]) => {
                      if (
                        varInfo.pouName === currentPou.data.name &&
                        varInfo.variable.name.includes(blockData.numericId!)
                      ) {
                        const compositeKey = `${varInfo.pouName}:${varInfo.variable.name}`
                        debugVariableKeys.add(compositeKey)
                      }
                    })
                  }
                }
              })
            })
          }
        }

        const allIndexes = Array.from(variableInfoMapRef.current.entries())
          .filter(([_, varInfo]) => {
            const compositeKey = `${varInfo.pouName}:${varInfo.variable.name}`
            return debugVariableKeys.has(compositeKey)
          })
          .map(([index, _]) => index)
          .sort((a, b) => a - b)

        if (allIndexes.length === 0) {
          return
        }

        const { workspace: currentWorkspace } = useOpenPLCStore.getState()
        const newValues = new Map<string, string>()
        currentWorkspace.debugVariableValues.forEach((value: string, key: string) => {
          newValues.set(key, value)
        })
        let currentBatchSize = batchSize
        let processedCount = 0

        while (processedCount < allIndexes.length) {
          const batch = allIndexes.slice(processedCount, processedCount + currentBatchSize)

          const result = await window.bridge.debuggerGetVariablesList(batch)

          if (!result.success) {
            if (result.needsReconnect) {
              const { consoleActions, workspaceActions } = useOpenPLCStore.getState()
              consoleActions.addLog({
                id: crypto.randomUUID(),
                level: 'error',
                message: `Debugger connection lost: ${result.error || 'Unknown error'}. Attempting to reconnect...`,
              })

              if (result.error?.includes('Failed to reconnect')) {
                workspaceActions.setDebuggerVisible(false)
                workspaceActions.setDebugForcedVariables(new Map())
                consoleActions.addLog({
                  id: crypto.randomUUID(),
                  level: 'error',
                  message: 'Debugger session closed due to connection failure.',
                })
                return
              }
            }

            if (result.error === 'ERROR_OUT_OF_MEMORY' && currentBatchSize > 2) {
              currentBatchSize = Math.max(2, Math.floor(currentBatchSize / 2))
              continue
            } else {
              break
            }
          }

          if (!result.data || result.lastIndex === undefined) {
            break
          }

          if (!Array.isArray(result.data)) {
            break
          }

          const responseBuffer = new Uint8Array(result.data)
          let bufferOffset = 0

          for (const index of batch) {
            const varInfo = variableInfoMapRef.current?.get(index)
            if (!varInfo) continue

            const { pouName, variable } = varInfo
            const compositeKey = `${pouName}:${variable.name}`

            if (bufferOffset >= responseBuffer.length) {
              break
            }

            try {
              const { value, bytesRead } = parseVariableValue(responseBuffer, bufferOffset, variable)
              newValues.set(compositeKey, value)
              bufferOffset += bytesRead
            } catch {
              newValues.set(compositeKey, 'ERR')
              bufferOffset += getVariableSize(variable)
            }

            if (index === result.lastIndex) {
              processedCount = batch.indexOf(index) + processedCount + 1
              break
            }
          }

          if (result.lastIndex === batch[batch.length - 1]) {
            processedCount += batch.length
          }
        }

        if (isMountedRef.current) {
          workspaceActions.setDebugVariableValues(newValues)
        }
      } catch (error) {
        const { consoleActions } = useOpenPLCStore.getState()
        consoleActions.addLog({
          id: `debugger-poll-error-${Date.now()}`,
          level: 'error',
          message: `Debugger polling error: ${String(error)}`,
        })
      }
    }

    void pollVariables()
    pollingIntervalRef.current = setInterval(() => {
      void pollVariables()
    }, DEBUGGER_POLL_INTERVAL_MS)

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
        pollingIntervalRef.current = null
      }
      void window.bridge.debuggerDisconnect().catch((error) => {
        const { consoleActions } = useOpenPLCStore.getState()
        consoleActions.addLog({
          id: crypto.randomUUID(),
          level: 'error',
          message: `Failed to disconnect debugger: ${String(error)}`,
        })
      })
    }
  }, [isDebuggerVisible])

  useEffect(() => {
    let logsPollingInterval: NodeJS.Timeout | null = null

    const pollLogs = async (): Promise<void> => {
      const {
        runtimeConnection: { connectionStatus, ipAddress, jwtToken, plcStatus },
        workspaceActions,
      } = useOpenPLCStore.getState()

      if (connectionStatus === 'connected') {
        workspaceActions.setPlcLogsVisible(true)
      } else {
        workspaceActions.setPlcLogsVisible(false)
        workspaceActions.setPlcLogs('')
        return
      }

      if (ipAddress && jwtToken && plcStatus === 'RUNNING') {
        try {
          const result = await window.bridge.runtimeGetLogs(ipAddress, jwtToken)
          if (result.success && result.logs !== undefined) {
            workspaceActions.setPlcLogs(result.logs)
          } else {
            console.error('Failed to fetch PLC logs:', result.error ?? 'Unknown error')
          }
        } catch (error: unknown) {
          console.error('Error polling PLC logs:', String(error))
        }
      }
    }

    void pollLogs()

    logsPollingInterval = setInterval(() => {
      void pollLogs()
    }, PLC_LOGS_POLL_INTERVAL_MS)

    return () => {
      if (logsPollingInterval) {
        clearInterval(logsPollingInterval)
      }
    }
  }, [])

  type PanelMethods = {
    collapse: () => void
    expand: () => void
  } & ImperativePanelHandle

  const panelRef = useRef<ImperativePanelHandle | null>(null)
  const explorerPanelRef = useRef<PanelMethods | null>(null)
  const workspacePanelRef = useRef<PanelMethods | null>(null)
  const consolePanelRef = useRef<PanelMethods | null>(null)
  const hasSearchResults = searchResults.length > 0

  const togglePanel = () => {
    if (panelRef.current) {
      panelRef.current.resize(25)
    }
  }

  useEffect(() => {
    if (hasSearchResults) {
      setActiveTab('search')
    } else {
      setActiveTab('console')
    }
  }, [hasSearchResults])

  useEffect(() => {
    const action = isCollapsed ? 'collapse' : 'expand'
    ;[explorerPanelRef, workspacePanelRef, consolePanelRef].forEach((ref) => {
      if (ref.current && typeof ref.current[action] === 'function') {
        ref.current[action]()
      }
    })
  }, [isCollapsed])
  useEffect(() => {
    const getAvailableBoardOptions = async () => {
      const boards = await window.bridge.getAvailableBoards()
      setAvailableOptions({ availableBoards: boards })
    }
    void getAvailableBoardOptions()
  }, [])
  const [isSwitchingPerspective, setIsSwitchingPerspective] = useState(false)

  const handleSwitchPerspective = () => {
    if (!isSwitchingPerspective) {
      setIsSwitchingPerspective(true)
      toggleCollapse()
    }
  }

  useEffect(() => {
    window.bridge.switchPerspective((_event) => {
      handleSwitchPerspective()
    })
  }, [])

  return (
    <div className='flex h-full w-full bg-brand-dark dark:bg-neutral-950'>
      <AboutModal />
      <ConfirmDeviceSwitchModal />
      <RuntimeCreateUserModal />
      <RuntimeLoginModal />
      <DebuggerMessageModal />
      <DebuggerIpInputModal />
      <WorkspaceSideContent>
        <WorkspaceActivityBar
          defaultActivityBar={{
            zoom: {
              onClick: () => void toggleCollapse(),
            },
          }}
        />
      </WorkspaceSideContent>
      <WorkspaceMainContent>
        <ResizablePanelGroup
          id='mainContentPanelGroup'
          direction='horizontal'
          className='relative flex h-full w-full gap-2'
        >
          <Explorer collapse={explorerPanelRef} />

          <ResizablePanel
            ref={workspacePanelRef}
            id='workspacePanel'
            order={2}
            defaultSize={87}
            className='relative flex h-full w-[400px]'
          >
            <ResizableHandle
              id='workspaceHandle'
              hitAreaMargins={{ coarse: 3, fine: 3 }}
              className='absolute bottom-0 top-0 z-[99] my-[2px] w-[4px] py-2 transition-colors duration-200 data-[resize-handle-active="pointer"]:bg-brand-light data-[resize-handle-state="hover"]:bg-brand-light data-[resize-handle-active="pointer"]:dark:bg-neutral-700  data-[resize-handle-state="hover"]:dark:bg-neutral-700'
            />
            <div id='workspaceContentPanel' className='flex h-full flex-1 grow flex-col gap-2 overflow-hidden'>
              {tabs.length > 0 && <Navigation />}
              <ResizablePanelGroup id='editorPanelGroup' className={`flex h-full gap-2`} direction='vertical'>
                <ResizablePanel
                  id='editorPanel'
                  order={1}
                  minSize={45}
                  defaultSize={75}
                  className={cn(
                    'relative  flex flex-1 grow flex-col overflow-hidden rounded-lg border-2 border-neutral-200 bg-white px-4 py-4 dark:border-neutral-800 dark:bg-neutral-950',
                    {
                      'py-0 pb-4': isVariablesPanelCollapsed,
                    },
                  )}
                >
                  {isVariablesPanelCollapsed && (
                    <div className='flex w-full justify-center'>
                      <button
                        className='flex w-auto items-center rounded-b-lg border-brand bg-neutral-50 px-2 py-1 dark:bg-neutral-900'
                        onClick={togglePanel}
                      >
                        <p className='text-xs font-medium text-brand-medium dark:text-brand-light'>Expand Table</p>
                        <ExitIcon
                          size='sm'
                          className='-rotate-90 select-none fill-brand-medium  stroke-brand dark:fill-brand-light dark:stroke-brand-light'
                        />
                      </button>
                    </div>
                  )}

                  {/**
                   * TODO: Need to be refactored.
                   * Must handle 3 types of editors: Textual editor, data type editor and graphical editor
                   */}
                  {tabs.length > 0 ? (
                    <>
                      {editor['type'] === 'plc-resource' && <ResourcesEditor />}
                      {editor['type'] === 'plc-device' && <DeviceEditor />}
                      {editor['type'] === 'plc-datatype' && <DataTypeEditor dataTypeName={editor.meta.name} />}
                      {(editor['type'] === 'plc-textual' || editor['type'] === 'plc-graphical') && (
                        <ResizablePanelGroup
                          id='editorContentPanelGroup'
                          direction='vertical'
                          className='flex flex-1 flex-col gap-1'
                        >
                          <ResizablePanel
                            ref={panelRef}
                            id='variableTablePanel'
                            order={1}
                            collapsible
                            onCollapse={() => {
                              setIsVariablesPanelCollapsed(true)
                            }}
                            onExpand={() => setIsVariablesPanelCollapsed(false)}
                            collapsedSize={0}
                            defaultSize={25}
                            minSize={20}
                            className={`relative flex h-full w-full flex-1 flex-col gap-4 overflow-auto`}
                          >
                            <VariablesEditor />
                          </ResizablePanel>

                          <ResizableHandle
                            style={{ height: '1px' }}
                            className={`${isVariablesPanelCollapsed && ' !hidden '}  flex  w-full bg-brand-light `}
                          />

                          <ResizablePanel
                            // onDrop={editor.type === 'plc-textual' ? handleDrop : undefined}
                            defaultSize={75}
                            id='textualEditorPanel'
                            order={2}
                            className='mt-4 flex-1 flex-grow rounded-md'
                          >
                            {editor['type'] === 'plc-textual' ? (
                              <MonacoEditor
                                name={editor.meta.name}
                                language={editor.meta.language}
                                path={editor.meta.path}
                              />
                            ) : (
                              <GraphicalEditor
                                name={editor.meta.name}
                                language={editor.meta.language}
                                path={editor.meta.path}
                              />
                            )}
                          </ResizablePanel>
                        </ResizablePanelGroup>
                      )}
                      <ResizableHandle
                        id='consoleResizeHandle'
                        hitAreaMargins={{ coarse: 2, fine: 2 }}
                        style={{ height: '2px', width: 'calc(100% - 16px)' }}
                        className={`absolute bottom-0 left-0 mx-2 transition-colors duration-200 data-[resize-handle-active="pointer"]:bg-brand-light data-[resize-handle-state="hover"]:bg-brand-light data-[resize-handle-active="pointer"]:dark:bg-neutral-700 data-[resize-handle-state="hover"]:dark:bg-neutral-700`}
                      />
                    </>
                  ) : (
                    <p className='mx-auto my-auto flex cursor-default select-none flex-col items-center gap-1 font-display text-xl font-medium'>
                      No tabs open
                    </p>
                  )}
                  <ResizableHandle
                    id='consoleResizeHandle'
                    hitAreaMargins={{ coarse: 2, fine: 2 }}
                    style={{ height: '2px', width: 'calc(100% - 16px)' }}
                    className={`absolute bottom-0 left-0 mx-2 transition-colors duration-200 data-[resize-handle-active="pointer"]:bg-brand-light data-[resize-handle-state="hover"]:bg-brand-light data-[resize-handle-active="pointer"]:dark:bg-neutral-700 data-[resize-handle-state="hover"]:dark:bg-neutral-700`}
                  />
                </ResizablePanel>
                <ResizablePanel
                  ref={consolePanelRef}
                  id='consolePanel'
                  order={2}
                  collapsible
                  defaultSize={31}
                  minSize={22}
                  className='flex-1 grow  rounded-lg border-2 border-neutral-200 bg-white p-4 data-[panel-size="0.0"]:hidden dark:border-neutral-800 dark:bg-neutral-950'
                >
                  <Tabs.Root
                    value={activeTab}
                    onValueChange={setActiveTab}
                    className='relative flex h-full w-full flex-col gap-2 overflow-hidden'
                  >
                    <Tabs.List className='flex h-7 w-64 select-none gap-4'>
                      <Tabs.Trigger
                        value='console'
                        className='h-7 w-16 rounded-md bg-neutral-100 text-xs font-medium text-brand-light data-[state=active]:bg-blue-500 data-[state=active]:text-white dark:bg-neutral-900  dark:text-neutral-700'
                      >
                        Console
                      </Tabs.Trigger>
                      {isDebuggerVisible && (
                        <Tabs.Trigger
                          value='debug'
                          className='h-7 w-16 rounded-md bg-neutral-100 text-xs font-medium text-brand-light data-[state=active]:bg-blue-500 data-[state=active]:text-white dark:bg-neutral-900  dark:text-neutral-700'
                        >
                          Debugger
                        </Tabs.Trigger>
                      )}
                      {isPlcLogsVisible && (
                        <Tabs.Trigger
                          value='plc-logs'
                          className='h-7 w-20 rounded-md bg-neutral-100 text-xs font-medium text-brand-light data-[state=active]:bg-blue-500 data-[state=active]:text-white dark:bg-neutral-900  dark:text-neutral-700'
                        >
                          PLC Logs
                        </Tabs.Trigger>
                      )}
                      {hasSearchResults && (
                        <Tabs.Trigger
                          value='search'
                          className='h-7 w-16 rounded-md bg-neutral-100 text-xs font-medium text-brand-light data-[state=active]:bg-blue-500 data-[state=active]:text-white dark:bg-neutral-900  dark:text-neutral-700'
                        >
                          Search
                        </Tabs.Trigger>
                      )}
                    </Tabs.List>
                    <Tabs.Content
                      aria-label='Console panel content'
                      value='console'
                      className='h-full w-full overflow-hidden p-2 data-[state=inactive]:hidden'
                    >
                      <ConsoleComponent />
                    </Tabs.Content>
                    {isDebuggerVisible && (
                      <Tabs.Content
                        value='debug'
                        className='debug-panel flex  h-full w-full overflow-hidden  data-[state=inactive]:hidden'
                      >
                        <ResizablePanelGroup direction='horizontal' className='flex h-full w-full '>
                          <ResizablePanel minSize={15} defaultSize={20} className='h-full w-full'>
                            <VariablesPanel
                              variables={debugVariables}
                              variableTree={filteredDebugVariableTree}
                              graphList={graphList}
                              setGraphList={setGraphList}
                              debugVariableValues={debugVariableValues}
                            />
                          </ResizablePanel>
                          <ResizableHandle className='w-2 bg-transparent' />
                          <ResizablePanel minSize={20} defaultSize={80} className='h-full w-full'>
                            <Debugger graphList={graphList} />
                          </ResizablePanel>
                        </ResizablePanelGroup>
                      </Tabs.Content>
                    )}
                    {isPlcLogsVisible && (
                      <Tabs.Content
                        aria-label='PLC Logs panel content'
                        value='plc-logs'
                        className='h-full w-full overflow-hidden p-2 data-[state=inactive]:hidden'
                      >
                        <PlcLogs />
                      </Tabs.Content>
                    )}
                    {hasSearchResults && (
                      <Tabs.Content
                        value='search'
                        className='debug-panel flex  h-full w-full overflow-hidden  data-[state=inactive]:hidden'
                      >
                        <ResizablePanelGroup direction='horizontal' className='flex h-full w-full '>
                          <ResizablePanel minSize={20} defaultSize={100} className='h-full w-full'>
                            <Search items={searchResults} />
                          </ResizablePanel>
                        </ResizablePanelGroup>
                      </Tabs.Content>
                    )}
                    {activeTab === 'console' && <ClearConsoleButton />}
                  </Tabs.Root>
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </WorkspaceMainContent>
    </div>
  )
}

export { WorkspaceScreen }
