import { ClearConsoleButton } from '@components/_atoms/buttons/console/clear-console'
import * as Tabs from '@radix-ui/react-tabs'
import { useRuntimePolling } from '@root/renderer/hooks/use-runtime-polling'
import { DebugTreeNode } from '@root/types/debugger'
import { isV4Logs, LOG_BUFFER_CAP } from '@root/types/PLC/runtime-logs'
import { cn, isOpenPLCRuntimeTarget } from '@root/utils'
import {
  appendToDebugPath,
  buildDebugPath,
  getFieldIndexFromMapWithFallback,
  getIndexFromMapWithFallback,
} from '@root/utils/debug-variable-finder'
import { useEffect, useRef, useState } from 'react'
import { ImperativePanelHandle } from 'react-resizable-panels'

import { ExitIcon } from '../assets'
import { DataTypeEditor, MonacoEditor } from '../components/_features/[workspace]/editor'
import { DeviceEditor } from '../components/_features/[workspace]/editor/device'
import { RemoteDeviceEditor } from '../components/_features/[workspace]/editor/device/remote-device'
import { GraphicalEditor } from '../components/_features/[workspace]/editor/graphical'
import { ResourcesEditor } from '../components/_features/[workspace]/editor/resource-editor'
import {
  ModbusServerEditor,
  OpcUaServerEditor,
  S7CommServerEditor,
} from '../components/_features/[workspace]/editor/server'
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
      debugVariableIndexes,
      debugForcedVariables,
      debugExpandedNodes,
    },
    editor,
    workspaceActions: { toggleCollapse, setDebugForcedVariables, toggleDebugExpandedNode },
    deviceActions: { setAvailableOptions },
    searchResults,
    project: {
      data: { pous },
    },
  } = useOpenPLCStore()

  // Get FB debug context for transforming FB variable keys
  const {
    workspace: { fbSelectedInstance, fbDebugInstances },
  } = useOpenPLCStore()

  // Global runtime status polling - runs continuously while connected to runtime
  // This ensures the sidebar start/stop button updates correctly from the store
  useRuntimePolling()

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

        // For function block POUs, transform the key to use instance context
        let compositeKey: string
        let displayName: string
        if (pou.type === 'function-block') {
          const fbTypeKey = pou.data.name.toUpperCase() // Canonical key for map lookups
          const selectedKey = fbSelectedInstance.get(fbTypeKey)
          const instances = fbDebugInstances.get(fbTypeKey) || []
          const selectedInstance = instances.find((inst) => inst.key === selectedKey)

          if (selectedInstance) {
            // Transform to instance context: main:MOTOR_SPEED0.varName
            compositeKey = `${selectedInstance.programName}:${selectedInstance.fbVariableName}.${v.name}`
            // Display with full path: main.MOTOR_SPEED0.varName
            displayName = `${selectedInstance.programName}.${selectedInstance.fbVariableName}.${v.name}`
          } else {
            // No instance selected, use original format
            compositeKey = `${pou.data.name}:${v.name}`
            displayName = v.name
          }
        } else {
          compositeKey = `${pou.data.name}:${v.name}`
          displayName = v.name
        }

        const variableValue = debugVariableValues.get(compositeKey)
        const displayValue = variableValue !== undefined ? variableValue : '-'

        return {
          pouName: pou.data.name,
          name: displayName,
          type: typeValue,
          value: displayValue,
          compositeKey,
        }
      })
  })

  const nameOccurrences = new Map<string, number>()
  allDebugVariables.forEach((v) => {
    nameOccurrences.set(v.name, (nameOccurrences.get(v.name) || 0) + 1)
  })

  const debugVariables = allDebugVariables.map((v) => {
    const hasConflict = nameOccurrences.get(v.name)! > 1
    return {
      name: hasConflict ? `[${v.pouName}] ${v.name}` : v.name,
      type: v.type,
      value: v.value,
      compositeKey: v.compositeKey,
    }
  })

  const watchedCompositeKeys = new Set<string>(allDebugVariables.map((v) => v.compositeKey))

  const forcedKeys = Array.from(debugForcedVariables.keys())
  const allKeys = new Set([...watchedCompositeKeys, ...forcedKeys])

  const filteredDebugVariableTree = debugVariableTree
    ? new Map<string, DebugTreeNode>(
        Array.from(debugVariableTree.entries() as Iterable<[string, DebugTreeNode]>).filter(([key]) =>
          allKeys.has(key),
        ),
      )
    : undefined

  const [graphList, setGraphList] = useState<string[]>([])
  const [isVariablesPanelCollapsed, setIsVariablesPanelCollapsed] = useState(false)
  const [activeTab, setActiveTab] = useState('console')

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const isMountedRef = useRef(true)
  const graphListRef = useRef<string[]>([])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // Keep graphListRef in sync with graphList state for use in polling
  useEffect(() => {
    graphListRef.current = graphList
  }, [graphList])

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

    // Helper function to ensure ENO variable exists in FB variable list
    // ENO is always present in debug.c for function blocks but may not be in the type definition
    const ensureEnoVariable = (
      fbVars: Array<{ name: string; class: string; type: { definition: string; value: string } }>,
    ): Array<{ name: string; class: string; type: { definition: string; value: string } }> => {
      const hasEno = fbVars.some((v) => v.type.definition === 'base-type' && v.name.toUpperCase() === 'ENO')
      if (hasEno) return fbVars
      return [...fbVars, { name: 'ENO', class: 'output', type: { definition: 'base-type', value: 'BOOL' } }]
    }

    // Helper function to recursively process nested FB and struct variables
    const processNestedVariables = (
      fbVariables: Array<{ name: string; class: string; type: { definition: string; value: string } }>,
      pouName: string,
      debugPathPrefix: string,
      variableNamePrefix: string,
    ) => {
      fbVariables.forEach((fbVar) => {
        if (fbVar.type.definition === 'base-type') {
          // Base type variable - add to variableInfoMap
          // Use fallback to try both FB-style and struct-style paths
          const index = getFieldIndexFromMapWithFallback(debugVariableIndexes, debugPathPrefix, fbVar.name)

          if (index !== undefined) {
            const varName = `${variableNamePrefix}.${fbVar.name}`
            variableInfoMap.set(index, {
              pouName,
              variable: {
                name: varName,
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
        } else if (fbVar.type.definition === 'derived') {
          // Nested function block - recursively process
          const nestedFBTypeName = fbVar.type.value.toUpperCase()
          const nestedDebugPath = appendToDebugPath(debugPathPrefix, fbVar.name)
          const nestedVarName = `${variableNamePrefix}.${fbVar.name}`

          // Look up the nested FB definition
          let nestedFBVariables:
            | Array<{ name: string; class: string; type: { definition: string; value: string } }>
            | undefined

          const standardFB = StandardFunctionBlocks.pous.find(
            (fb: { name: string }) => fb.name.toUpperCase() === nestedFBTypeName,
          )
          if (standardFB) {
            nestedFBVariables = ensureEnoVariable(standardFB.variables)
          } else {
            const customFB = project.data.pous.find(
              (p) => p.type === 'function-block' && p.data.name.toUpperCase() === nestedFBTypeName,
            )
            if (customFB && customFB.type === 'function-block') {
              nestedFBVariables = ensureEnoVariable(
                customFB.data.variables as Array<{
                  name: string
                  class: string
                  type: { definition: string; value: string }
                }>,
              )
            }
          }

          if (nestedFBVariables) {
            processNestedVariables(nestedFBVariables, pouName, nestedDebugPath, nestedVarName)
          }
        } else if (fbVar.type.definition === 'user-data-type') {
          // Nested struct - recursively process
          const structTypeName = fbVar.type.value
          const nestedDebugPath = appendToDebugPath(debugPathPrefix, fbVar.name)
          const nestedVarName = `${variableNamePrefix}.${fbVar.name}`

          // Check if this is actually a function block (some FBs are defined as user-data-type)
          const typeNameUpper = structTypeName.toUpperCase()
          const isStandardFB = StandardFunctionBlocks.pous.some(
            (pou: { name: string; type: string }) =>
              pou.name.toUpperCase() === typeNameUpper &&
              pou.type.toLowerCase().replace(/[-_]/g, '') === 'functionblock',
          )
          const isCustomFB = project.data.pous.some(
            (pou) => pou.type === 'function-block' && pou.data.name.toUpperCase() === typeNameUpper,
          )

          if (isStandardFB || isCustomFB) {
            // It's actually a function block
            let nestedFBVariables:
              | Array<{ name: string; class: string; type: { definition: string; value: string } }>
              | undefined

            const standardFB = StandardFunctionBlocks.pous.find(
              (fb: { name: string }) => fb.name.toUpperCase() === typeNameUpper,
            )
            if (standardFB) {
              nestedFBVariables = ensureEnoVariable(standardFB.variables)
            } else {
              const customFB = project.data.pous.find(
                (p) => p.type === 'function-block' && p.data.name.toUpperCase() === typeNameUpper,
              )
              if (customFB && customFB.type === 'function-block') {
                nestedFBVariables = ensureEnoVariable(
                  customFB.data.variables as Array<{
                    name: string
                    class: string
                    type: { definition: string; value: string }
                  }>,
                )
              }
            }

            if (nestedFBVariables) {
              processNestedVariables(nestedFBVariables, pouName, nestedDebugPath, nestedVarName)
            }
          } else {
            // It's a struct - look up the struct definition
            const structType = project.data.dataTypes.find((dt) => dt.name.toUpperCase() === typeNameUpper)

            if (structType && structType.derivation === 'structure') {
              const structVariables: Array<{
                name: string
                class: string
                type: { definition: string; value: string }
              }> = structType.variable.map((field) => ({
                name: field.name,
                class: 'local' as const,
                type: { definition: field.type.definition, value: field.type.value },
              }))
              processNestedVariables(structVariables, pouName, nestedDebugPath, nestedVarName)
            }
          }
        }
      })
    }

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
              // Use fallback to try both FB-style and struct-style paths
              const index = getIndexFromMapWithFallback(
                debugVariableIndexes,
                programInstance.name,
                `${fbInstance.name}.${fbVar.name}`,
              )

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

            // Process nested FB and struct variables recursively
            const nestedVariables = fbVariables.filter(
              (v) => v.type.definition === 'derived' || v.type.definition === 'user-data-type',
            )
            if (nestedVariables.length > 0) {
              const debugPathPrefix = buildDebugPath(programInstance.name, fbInstance.name)
              const variableNamePrefix = fbInstance.name
              processNestedVariables(nestedVariables, pou.data.name, debugPathPrefix, variableNamePrefix)
            }
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
                  // Use fallback to try both FB-style and struct-style paths
                  const index = getIndexFromMapWithFallback(
                    debugVariableIndexes,
                    programInstance.name,
                    `_TMP_${blockName}${numericId}_${outputVar.name}`,
                  )

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

    // Central FB instance visitor that handles ALL variable types at arbitrary nesting depth
    // This is the unified entry point for processing FB instances, handling:
    // 1. Base-type variables of the FB
    // 2. Nested FB/struct variables (via processNestedVariables)
    // 3. Function temps in ladder (for functions with execution control)
    // 4. Recursive processing of nested FB instances
    const visitFbInstance = (
      fbPou: (typeof project.data.pous)[0],
      debugPathPrefix: string,
      variablePathPrefix: string,
      programPouName: string,
      _blockExecutionControlMap: Map<string, boolean>,
    ) => {
      if (fbPou.type !== 'function-block') return

      const fbVariables = fbPou.data.variables as Array<{
        name: string
        class: string
        type: { definition: string; value: string }
      }>

      // 1. Process base-type variables of this FB
      const baseTypeVars = fbVariables.filter((v) => v.type.definition === 'base-type')
      baseTypeVars.forEach((fbVar) => {
        // Use fallback to try both FB-style and struct-style paths
        const index = getFieldIndexFromMapWithFallback(debugVariableIndexes, debugPathPrefix, fbVar.name)

        if (index !== undefined) {
          const varName = `${variablePathPrefix}.${fbVar.name}`
          variableInfoMap.set(index, {
            pouName: programPouName,
            variable: {
              name: varName,
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

      // 2. Process nested FB and struct variables recursively
      const nestedVariables = fbVariables.filter(
        (v) => v.type.definition === 'derived' || v.type.definition === 'user-data-type',
      )
      if (nestedVariables.length > 0) {
        processNestedVariables(nestedVariables, programPouName, debugPathPrefix, variablePathPrefix)
      }

      // 3. Process function temps in ladder (if this FB has a ladder body)
      if (fbPou.data.body.language === 'ld') {
        const fbLadderFlow = ladderFlows.find((flow) => flow.name === fbPou.data.name)
        if (fbLadderFlow) {
          // Build execution control map for blocks in this FB's ladder
          const fbBlockExecutionControlMap = new Map<string, boolean>()
          fbLadderFlow.rungs.forEach((rung) => {
            rung.nodes.forEach((node) => {
              if (node.type === 'block') {
                const blockData = node.data as { variable?: { name: string }; executionControl?: boolean }
                if (blockData.variable?.name && blockData.executionControl) {
                  fbBlockExecutionControlMap.set(blockData.variable.name, true)
                }
              }
            })
          })

          // Process function blocks in this FB's ladder flow
          fbLadderFlow.rungs.forEach((rung) => {
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

              // Only process functions (not function blocks) for _TMP_ variables
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

              // Add ENO if execution control is enabled
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
                // Debug path uses the full nested path:
                // RES0__INSTANCE0.FB_B0.FB_A0._TMP_EQ_STATE7415072_ENO
                // Use fallback to try both FB-style and struct-style paths
                const index = getFieldIndexFromMapWithFallback(
                  debugVariableIndexes,
                  debugPathPrefix,
                  `_TMP_${blockName}${numericId}_${outputVar.name}`,
                )

                if (index !== undefined) {
                  // Variable name includes the full nested path for composite key matching
                  const tempVarName = `${variablePathPrefix}._TMP_${blockName}${numericId}_${outputVar.name}`
                  variableInfoMap.set(index, {
                    pouName: programPouName,
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

      // 4. Recursively visit nested FB instances declared as variables
      // Note: Standard FBs (TON, TOF, etc.) are already handled by processNestedVariables above
      // Here we only recurse into custom (user-defined) FBs to process their internal ladder/FBD
      const nestedFbInstances = fbVariables.filter((v) => v.type.definition === 'derived')
      nestedFbInstances.forEach((nestedFbInstance) => {
        const nestedFbTypeName = nestedFbInstance.type.value.toUpperCase()

        // Only recurse into custom FBs (user-defined), not standard library FBs
        const customFB = project.data.pous.find(
          (p) => p.type === 'function-block' && p.data.name.toUpperCase() === nestedFbTypeName,
        )

        if (customFB && customFB.type === 'function-block') {
          // For custom FBs, recursively visit to process their internals
          const nestedDebugPathPrefix = appendToDebugPath(debugPathPrefix, nestedFbInstance.name)
          const nestedVariablePathPrefix = `${variablePathPrefix}.${nestedFbInstance.name}`
          visitFbInstance(customFB, nestedDebugPathPrefix, nestedVariablePathPrefix, programPouName, new Map())
        }
      })
    }

    // Start from program POUs and find all FB instances
    const instances = project.data.configuration.resource.instances
    project.data.pous.forEach((programPou) => {
      if (programPou.type !== 'program') return

      const programInstance = instances.find((inst) => inst.program === programPou.data.name)
      if (!programInstance) return

      // Build execution control map for blocks in this program's ladder
      const blockExecutionControlMap = new Map<string, boolean>()
      if (programPou.data.body.language === 'ld') {
        const currentLadderFlow = ladderFlows.find((flow) => flow.name === programPou.data.name)
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

      // Find all FB instances in the program
      const fbInstances = programPou.data.variables.filter((v) => v.type.definition === 'derived')

      fbInstances.forEach((fbInstance) => {
        const fbTypeName = fbInstance.type.value.toUpperCase()

        // Check if it's a custom FB (user-defined)
        const customFB = project.data.pous.find(
          (p) => p.type === 'function-block' && p.data.name.toUpperCase() === fbTypeName,
        )

        if (customFB && customFB.type === 'function-block') {
          // For custom FBs, use visitFbInstance to process all internals
          const debugPathPrefix = buildDebugPath(programInstance.name, fbInstance.name)
          const variablePathPrefix = fbInstance.name
          visitFbInstance(customFB, debugPathPrefix, variablePathPrefix, programPou.data.name, blockExecutionControlMap)
        }
      })
    })

    variableInfoMapRef.current = variableInfoMap

    // Extend debugVariableIndexes with composite keys from variableInfoMap
    // This enables force variable functionality for FB POUs by ensuring all
    // composite keys (like main:IRRIGATION_MAIN_CONTROLLER0.SENSOR_INPUT) are
    // mapped to their debug indexes. Without this, force handlers can't find
    // the index for FB variables because debugVariableIndexes only contains
    // program-level keys (like main:COUNTER) from the initial parsing.
    const { workspaceActions: wsActions } = useOpenPLCStore.getState()
    const updatedIndexes = new Map(debugVariableIndexes)
    variableInfoMap.forEach((varInfo, index) => {
      const compositeKey = `${varInfo.pouName}:${varInfo.variable.name}`
      if (!updatedIndexes.has(compositeKey)) {
        updatedIndexes.set(compositeKey, index)
      }
    })
    wsActions.setDebugVariableIndexes(updatedIndexes)

    const pollVariables = async () => {
      if (!isMountedRef.current) return

      if (!variableInfoMapRef.current) {
        return
      }

      try {
        const { project: currentProject } = useOpenPLCStore.getState()

        const debugVariableKeys = new Set<string>()

        // Get FB debug context for function block POUs
        const {
          workspace: { fbSelectedInstance, fbDebugInstances },
        } = useOpenPLCStore.getState()

        currentProject.data.pous.forEach((pou) => {
          if (pou.type === 'program') {
            pou.data.variables
              .filter((v) => v.debug === true)
              .forEach((v) => {
                debugVariableKeys.add(`${pou.data.name}:${v.name}`)
              })
          } else if (pou.type === 'function-block') {
            // For function block POUs, transform variable keys using selected instance context
            const fbTypeKey = pou.data.name.toUpperCase() // Canonical key for map lookups
            const selectedKey = fbSelectedInstance.get(fbTypeKey)
            if (!selectedKey) return // No instance selected, skip

            // Find the instance info for the selected key
            const instances = fbDebugInstances.get(fbTypeKey) || []
            const selectedInstance = instances.find((inst) => inst.key === selectedKey)
            if (!selectedInstance) return // Instance not found, skip

            // Transform FB variable keys to use instance context
            // e.g., Calculate_PID:IN -> main:MOTOR_SPEED0.IN
            pou.data.variables
              .filter((v) => v.debug === true)
              .forEach((v) => {
                const transformedKey = `${selectedInstance.programName}:${selectedInstance.fbVariableName}.${v.name}`
                debugVariableKeys.add(transformedKey)
              })
          }
        })

        // Get the current expansion state from the store
        const {
          workspace: { debugExpandedNodes },
        } = useOpenPLCStore.getState()

        // Helper function to check if a nested variable should be polled based on expansion state
        // A nested variable should be polled if:
        // 1. It's in the graph list (for real-time plotting), OR
        // 2. It has a watched ancestor AND all nodes from that ancestor to this variable are expanded
        // This supports arbitrary nesting depth - e.g., adding TON0 from within an FB POU
        // creates a watched key like main:IRRIGATION_MAIN_CONTROLLER0.TON0, and its children
        // (like ET, PT) should be polled when TON0 is expanded
        const shouldPollNestedVariable = (varName: string, pouName: string, currentGraphList: string[]): boolean => {
          const parts = varName.split('.')
          if (parts.length <= 1) return true // Not a nested variable

          // Check if this variable is in the graph list
          const compositeKey = `${pouName}:${varName}`
          if (currentGraphList.includes(compositeKey)) {
            return true
          }

          // Find the deepest watched ancestor
          // For example, if varName is 'IRRIGATION_MAIN_CONTROLLER0.TON0.ET':
          // - Check if 'main:IRRIGATION_MAIN_CONTROLLER0.TON0' is watched (deepest)
          // - If not, check if 'main:IRRIGATION_MAIN_CONTROLLER0' is watched
          let watchedAncestorIndex = -1
          for (let i = parts.length - 1; i >= 1; i--) {
            const candidatePath = parts.slice(0, i).join('.')
            const candidateKey = `${pouName}:${candidatePath}`
            if (debugVariableKeys.has(candidateKey)) {
              watchedAncestorIndex = i
              break
            }
          }

          // If no ancestor is watched, don't poll this variable
          if (watchedAncestorIndex === -1) {
            return false
          }

          // Check if all nodes from the watched ancestor to this variable are expanded
          // Start from the watched ancestor (which must be expanded to see its children)
          for (let i = watchedAncestorIndex; i < parts.length; i++) {
            const parentPath = parts.slice(0, i).join('.')
            const parentKey = `${pouName}:${parentPath}`
            const isParentExpanded = debugExpandedNodes.get(parentKey) ?? false
            if (!isParentExpanded) {
              return false
            }
          }
          return true
        }

        // Add nested variables to polling based on expansion state
        // This now supports arbitrary nesting depth by finding the deepest watched ancestor
        Array.from(variableInfoMapRef.current.entries()).forEach(([_, varInfo]) => {
          if (varInfo.variable.name.includes('.')) {
            const childKey = `${varInfo.pouName}:${varInfo.variable.name}`

            // Check if this nested variable should be polled based on expansion state
            // shouldPollNestedVariable now handles finding the watched ancestor internally
            if (shouldPollNestedVariable(varInfo.variable.name, varInfo.pouName, graphListRef.current)) {
              debugVariableKeys.add(childKey)
            }
          }
        })

        const { editor, ladderFlows } = useOpenPLCStore.getState()
        const currentPou = currentProject.data.pous.find((pou) => pou.data.name === editor.meta.name)

        // Helper to create composite key for current POU, handling FB instance context
        const makeCompositeKeyForCurrentPou = (variableName: string): string | null => {
          if (!currentPou) return null
          if (currentPou.type === 'function-block') {
            const fbTypeKey = currentPou.data.name.toUpperCase()
            const selectedKey = fbSelectedInstance.get(fbTypeKey)
            if (!selectedKey) return null
            const instances = fbDebugInstances.get(fbTypeKey) || []
            const selectedInstance = instances.find((inst) => inst.key === selectedKey)
            if (!selectedInstance) return null
            return `${selectedInstance.programName}:${selectedInstance.fbVariableName}.${variableName}`
          }
          return `${currentPou.data.name}:${variableName}`
        }

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
                    const compositeKey = makeCompositeKeyForCurrentPou(variableName)
                    if (compositeKey) {
                      debugVariableKeys.add(compositeKey)
                    }
                  }
                }
              })
            })
          }

          // Get FB instance context for function block POUs
          let fbInstanceCtx: { programName: string; fbVariableName: string } | null = null
          if (currentPou.type === 'function-block') {
            const fbTypeKey = currentPou.data.name.toUpperCase()
            const selectedKey = fbSelectedInstance.get(fbTypeKey)
            if (selectedKey) {
              const instances = fbDebugInstances.get(fbTypeKey) || []
              const selectedInstance = instances.find((inst) => inst.key === selectedKey)
              if (selectedInstance) {
                fbInstanceCtx = {
                  programName: selectedInstance.programName,
                  fbVariableName: selectedInstance.fbVariableName,
                }
              }
            }
          }

          // For FB POUs, poll nested FB variables using instance context
          // For program POUs, poll FB instance variables using the standard approach
          if (currentPou.type === 'function-block' && fbInstanceCtx) {
            // Poll all nested BOOL variables within the FB instance
            Array.from(variableInfoMapRef.current.entries()).forEach(([_, varInfo]) => {
              if (
                varInfo.pouName === fbInstanceCtx.programName &&
                varInfo.variable.name.startsWith(`${fbInstanceCtx.fbVariableName}.`) &&
                varInfo.variable.type.definition === 'base-type' &&
                varInfo.variable.type.value.toLowerCase() === 'bool'
              ) {
                const compositeKey = `${varInfo.pouName}:${varInfo.variable.name}`
                debugVariableKeys.add(compositeKey)
              }
            })
          } else {
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
          }

          // For FB POUs, poll function outputs using instance context
          // For program POUs, poll function outputs using the standard approach
          if (currentPou.type === 'function-block' && fbInstanceCtx && currentLadderFlow) {
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
                        varInfo.pouName === fbInstanceCtx.programName &&
                        varInfo.variable.name.startsWith(`${fbInstanceCtx.fbVariableName}.`) &&
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
          } else {
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
        }

        const { fbdFlows } = useOpenPLCStore.getState()
        if (currentPou && currentPou.data.body.language === 'fbd') {
          const currentFbdFlow = fbdFlows.find((flow) => flow.name === editor.meta.name)
          if (currentFbdFlow) {
            currentFbdFlow.rung.nodes.forEach((node) => {
              if (node.type === 'input-variable' || node.type === 'output-variable' || node.type === 'inout-variable') {
                const nodeData = node.data as {
                  variable?: { name?: string }
                }
                const variableName = nodeData.variable?.name

                if (variableName) {
                  const variable = currentPou.data.variables.find(
                    (v) => v.name.toLowerCase() === variableName.toLowerCase(),
                  )
                  if (variable && variable.type.value.toUpperCase() === 'BOOL') {
                    const compositeKey = makeCompositeKeyForCurrentPou(variableName)
                    if (compositeKey) {
                      debugVariableKeys.add(compositeKey)
                    }
                  }
                }
              }
            })
          }

          // Get FB instance context for function block POUs (FBD)
          let fbdFbInstanceCtx: { programName: string; fbVariableName: string } | null = null
          if (currentPou.type === 'function-block') {
            const fbTypeKey = currentPou.data.name.toUpperCase()
            const selectedKey = fbSelectedInstance.get(fbTypeKey)
            if (selectedKey) {
              const instances = fbDebugInstances.get(fbTypeKey) || []
              const selectedInstance = instances.find((inst) => inst.key === selectedKey)
              if (selectedInstance) {
                fbdFbInstanceCtx = {
                  programName: selectedInstance.programName,
                  fbVariableName: selectedInstance.fbVariableName,
                }
              }
            }
          }

          // For FB POUs, poll nested FB variables using instance context
          // For program POUs, poll FB instance variables using the standard approach
          if (currentPou.type === 'function-block' && fbdFbInstanceCtx) {
            // Poll all nested BOOL variables within the FB instance
            Array.from(variableInfoMapRef.current.entries()).forEach(([_, varInfo]) => {
              if (
                varInfo.pouName === fbdFbInstanceCtx.programName &&
                varInfo.variable.name.startsWith(`${fbdFbInstanceCtx.fbVariableName}.`) &&
                varInfo.variable.type.definition === 'base-type' &&
                varInfo.variable.type.value.toLowerCase() === 'bool'
              ) {
                const compositeKey = `${varInfo.pouName}:${varInfo.variable.name}`
                debugVariableKeys.add(compositeKey)
              }
            })
          } else {
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
          }

          // For FB POUs, poll function outputs using instance context
          // For program POUs, poll function outputs using the standard approach
          if (currentPou.type === 'function-block' && fbdFbInstanceCtx && currentFbdFlow) {
            currentFbdFlow.rung.nodes.forEach((node) => {
              if (node.type === 'block') {
                const blockData = node.data as {
                  variant?: { type: string }
                  numericId?: string
                }

                if (blockData.variant?.type === 'function' && blockData.numericId) {
                  Array.from(variableInfoMapRef.current!.entries()).forEach(([_, varInfo]) => {
                    if (
                      varInfo.pouName === fbdFbInstanceCtx.programName &&
                      varInfo.variable.name.startsWith(`${fbdFbInstanceCtx.fbVariableName}.`) &&
                      varInfo.variable.name.includes(blockData.numericId!)
                    ) {
                      const compositeKey = `${varInfo.pouName}:${varInfo.variable.name}`
                      debugVariableKeys.add(compositeKey)
                    }
                  })
                }
              }
            })
          } else {
            const instances = currentProject.data.configuration.resource.instances
            const programInstance = instances.find((inst) => inst.program === currentPou.data.name)
            if (programInstance && currentFbdFlow) {
              currentFbdFlow.rung.nodes.forEach((node) => {
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
            }
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
      } catch (error: unknown) {
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
      void window.bridge.debuggerDisconnect().catch((error: unknown) => {
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
        workspace: { plcLogsLastId, plcLogs },
        workspaceActions,
      } = useOpenPLCStore.getState()

      if (connectionStatus === 'connected') {
        workspaceActions.setPlcLogsVisible(true)
      } else {
        workspaceActions.setPlcLogsVisible(false)
        workspaceActions.clearPlcLogs()
        return
      }

      if (!ipAddress || !jwtToken) {
        return
      }

      // Detect if we're connected to v4 runtime (v4 returns array, v3 returns string)
      // For v4: poll regardless of PLC state
      // For v3: poll only when PLC is RUNNING
      const isV4Runtime = isV4Logs(plcLogs) || plcLogs === ''

      // For v3 runtime, only poll when RUNNING
      if (!isV4Runtime && plcStatus !== 'RUNNING') {
        return
      }

      try {
        // For v4 with existing logs, use incremental fetching
        const minId = isV4Runtime && plcLogsLastId !== null ? plcLogsLastId + 1 : undefined
        const result = await window.bridge.runtimeGetLogs(ipAddress, jwtToken, minId)

        if (result.success && result.logs !== undefined) {
          const newLogs = result.logs

          if (isV4Logs(newLogs)) {
            // V4 runtime: structured logs with levels
            if (newLogs.length === 0) {
              // No new logs
              return
            }

            // Detect runtime restart: if any returned ID is less than lastSeenId
            const hasRestartedRuntime =
              plcLogsLastId !== null && newLogs.some((log) => log.id !== null && log.id < plcLogsLastId)

            if (hasRestartedRuntime) {
              // Runtime restarted, clear logs and start fresh
              // Cap to last LOG_BUFFER_CAP entries if initial fetch is larger
              const cappedLogs = newLogs.length > LOG_BUFFER_CAP ? newLogs.slice(-LOG_BUFFER_CAP) : newLogs
              workspaceActions.setPlcLogs(cappedLogs)
            } else {
              // Append new logs to existing
              workspaceActions.appendPlcLogs(newLogs)
            }

            // Update lastId cursor to the highest ID in the new logs
            const maxId = newLogs.reduce((max, log) => {
              if (log.id !== null && log.id > max) {
                return log.id
              }
              return max
            }, plcLogsLastId ?? -1)

            if (maxId >= 0) {
              workspaceActions.setPlcLogsLastId(maxId)
            }
          } else {
            // V3 runtime: plain string logs (no incremental fetching)
            workspaceActions.setPlcLogs(newLogs)
          }
        } else {
          console.error('Failed to fetch PLC logs:', result.error ?? 'Unknown error')
        }
      } catch (error: unknown) {
        console.error('Error polling PLC logs:', String(error))
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
      setActiveTab((prev) => (prev === 'search' ? 'console' : prev))
    }
  }, [hasSearchResults])

  useEffect(() => {
    if (!isDebuggerVisible) {
      setActiveTab((prev) => (prev === 'debug' ? 'console' : prev))
    }
  }, [isDebuggerVisible])

  useEffect(() => {
    if (!isPlcLogsVisible) {
      setActiveTab((prev) => (prev === 'plc-logs' ? 'console' : prev))
    }
  }, [isPlcLogsVisible])

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

  useEffect(() => {
    const { deviceActions } = useOpenPLCStore.getState()
    const unsubscribe = window.bridge.onRuntimeTokenRefreshed((_event, newToken: string) => {
      deviceActions.setRuntimeJwtToken(newToken)
    }) as (() => void) | undefined

    return () => {
      unsubscribe?.()
    }
  }, [])

  const handleForceVariable = async (
    compositeKey: string,
    _variableType: string,
    value?: boolean,
    valueBuffer?: Uint8Array,
    lookupKey?: string,
  ): Promise<void> => {
    const keyForIndexLookup = lookupKey ?? compositeKey
    const variableIndex = debugVariableIndexes.get(keyForIndexLookup)
    if (variableIndex === undefined) return

    if (value === undefined) {
      const result = await window.bridge.debuggerSetVariable(variableIndex, false)
      if (result.success) {
        const newForcedVariables = new Map(Array.from(debugForcedVariables))
        newForcedVariables.delete(compositeKey)
        setDebugForcedVariables(newForcedVariables)
      }
    } else {
      const buffer = valueBuffer || new Uint8Array([value ? 1 : 0])
      const result = await window.bridge.debuggerSetVariable(variableIndex, true, buffer)
      if (result.success) {
        const newForcedVariables = new Map(Array.from(debugForcedVariables))
        newForcedVariables.set(compositeKey, value)
        setDebugForcedVariables(newForcedVariables)
      }
    }
  }
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
                      {editor['type'] === 'plc-server' && editor.meta.protocol === 'modbus-tcp' && (
                        <ModbusServerEditor />
                      )}
                      {editor['type'] === 'plc-server' && editor.meta.protocol === 's7comm' && <S7CommServerEditor />}
                      {editor['type'] === 'plc-server' && editor.meta.protocol === 'opcua' && <OpcUaServerEditor />}
                      {editor['type'] === 'plc-remote-device' && <RemoteDeviceEditor />}
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
                              debugVariableIndexes={debugVariableIndexes}
                              debugForcedVariables={debugForcedVariables}
                              debugExpandedNodes={debugExpandedNodes}
                              onToggleExpandedNode={toggleDebugExpandedNode}
                              isDebuggerVisible={isDebuggerVisible}
                              onForceVariable={handleForceVariable}
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
