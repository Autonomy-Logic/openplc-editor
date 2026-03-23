import * as Tabs from '@radix-ui/react-tabs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ImperativePanelHandle } from 'react-resizable-panels'

import { useCapabilities, useChatPanel, useDebugger, useDevice } from '../../middleware/shared/providers'
import { ExitIcon } from '../assets/icons/interface/Exit'
import { ClearConsoleButton } from '../components/_atoms/buttons/console/clear-console'
import { DataTypeEditor } from '../components/_features/[workspace]/data-type'
import { DeviceEditor } from '../components/_features/[workspace]/editor/device'
import { RemoteDeviceEditor } from '../components/_features/[workspace]/editor/device/remote-device'
import { GraphicalEditor } from '../components/_features/[workspace]/editor/graphical'
import { MonacoEditor } from '../components/_features/[workspace]/editor/monaco'
import { ResourcesEditor } from '../components/_features/[workspace]/editor/resource-editor'
import { ModbusServerEditor } from '../components/_features/[workspace]/editor/server/modbus-server'
import { OpcUaServerEditor } from '../components/_features/[workspace]/editor/server/opcua-server'
import { S7CommServerEditor } from '../components/_features/[workspace]/editor/server/s7comm-server'
import { Search } from '../components/_features/[workspace]/search'
import { VariablesPanel } from '../components/_molecules/variables-panel'
import { Console as ConsoleComponent } from '../components/_organisms/console'
import { ConsoleFilters } from '../components/_organisms/console/filters'
import { Debugger } from '../components/_organisms/debugger'
import { Explorer } from '../components/_organisms/explorer'
import { Navigation } from '../components/_organisms/navigation'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../components/_organisms/panel'
import { PlcLogs } from '../components/_organisms/plc-logs'
import { PlcLogsFilters } from '../components/_organisms/plc-logs/filters'
import { VariablesEditor } from '../components/_organisms/variables-editor'
import { WorkspaceActivityBar } from '../components/_organisms/workspace-activity-bar'
import { WorkspaceMainContent } from '../components/_templates/[workspace]/main-content'
import { WorkspaceSideContent } from '../components/_templates/[workspace]/side-content'
import { useRuntimePolling } from '../hooks/use-runtime-polling'
import { useOpenPLCStore } from '../store'
import { cn } from '../utils/cn'

const SIMULATOR_BOARD_NAME = 'OpenPLC Simulator'

const WorkspaceScreen = () => {
  const capabilities = useCapabilities()
  const ChatPanel = useChatPanel()
  const debuggerPort = useDebugger()
  const device = useDevice()

  const {
    tabs,
    workspace: {
      isCollapsed,
      isPlcLogsVisible,
      plcLogs,
      isDebuggerVisible,
      debugVariableValues,
      debugVariableTree,
      debugVariableIndexes,
      debugForcedVariables,
      debugExpandedNodes,
      fbSelectedInstance,
      fbDebugInstances,
    },
    editor,
    workspaceActions: {
      toggleCollapse,
      clearPlcLogs,
      setDebugForcedVariables,
      toggleDebugExpandedNode,
      setDebugGraphList,
    },
    deviceActions: { setAvailableOptions, setDeviceBoard },
    searchResults,
    ai: { isChatOpen, isEnabled: isAIEnabled, hasConsented: hasAIConsented },
    project: {
      data: { pous },
    },
  } = useOpenPLCStore()

  // Start global runtime polling for status and logs
  useRuntimePolling()

  // Build debug variables from POUs with debug=true
  const allDebugVariables = useMemo(
    () =>
      pous.flatMap((pou) => {
        const variables = pou.interface?.variables ?? []
        return variables
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
            if (pou.pouType === 'function-block') {
              const fbTypeKey = pou.name.toUpperCase()
              const selectedKey = fbSelectedInstance.get(fbTypeKey)
              const instances = fbDebugInstances.get(fbTypeKey) ?? []
              const selectedInstance = instances.find((inst) => inst.key === selectedKey)

              if (selectedInstance) {
                compositeKey = `${selectedInstance.programName}:${selectedInstance.fbVariableName}.${v.name}`
                displayName = `${selectedInstance.programName}.${selectedInstance.fbVariableName}.${v.name}`
              } else {
                compositeKey = `${pou.name}:${v.name}`
                displayName = v.name
              }
            } else {
              compositeKey = `${pou.name}:${v.name}`
              displayName = v.name
            }

            const variableValue = debugVariableValues.get(compositeKey)
            const displayValue = variableValue !== undefined ? variableValue : '-'

            return {
              pouName: pou.name,
              name: displayName,
              type: typeValue,
              value: displayValue,
              compositeKey,
            }
          })
      }),
    [pous, debugVariableValues, fbSelectedInstance, fbDebugInstances],
  )

  // Deduplicate names with POU prefix when conflicts exist
  const debugVariables = useMemo(() => {
    const nameOccurrences = new Map<string, number>()
    allDebugVariables.forEach((v) => {
      nameOccurrences.set(v.name, (nameOccurrences.get(v.name) || 0) + 1)
    })

    return allDebugVariables.map((v) => {
      const hasConflict = nameOccurrences.get(v.name)! > 1
      return {
        name: hasConflict ? `[${v.pouName}] ${v.name}` : v.name,
        type: v.type,
        value: v.value,
        compositeKey: v.compositeKey,
      }
    })
  }, [allDebugVariables])

  // Filter debug variable tree to only include watched or forced keys
  const filteredDebugVariableTree = useMemo(() => {
    const watchedCompositeKeys = new Set<string>(allDebugVariables.map((v) => v.compositeKey))
    const forcedKeys = Array.from(debugForcedVariables.keys())
    const allKeys = new Set([...watchedCompositeKeys, ...forcedKeys])
    return new Map(Array.from(debugVariableTree.entries()).filter(([key]) => allKeys.has(key)))
  }, [allDebugVariables, debugForcedVariables, debugVariableTree])

  // Force variable handler via DebuggerPort
  const handleForceVariable = useCallback(
    async (
      compositeKey: string,
      _variableType: string,
      value?: boolean,
      valueBuffer?: Uint8Array,
      lookupKey?: string,
    ): Promise<void> => {
      const keyForIndexLookup = lookupKey ?? compositeKey
      const variableIndex = debugVariableIndexes.get(keyForIndexLookup)
      if (variableIndex === undefined) return

      if (!debuggerPort.isConnected()) return

      if (value === undefined && valueBuffer === undefined) {
        // Release force
        const result = await debuggerPort.setVariable(variableIndex, false)
        if (result.success) {
          const newForced = new Map(debugForcedVariables)
          newForced.delete(compositeKey)
          setDebugForcedVariables(newForced)
        }
      } else {
        // Set force
        const buffer = valueBuffer ?? new Uint8Array([value ? 1 : 0])
        const result = await debuggerPort.setVariable(variableIndex, true, buffer)
        if (result.success) {
          const newForced = new Map(debugForcedVariables)
          newForced.set(compositeKey, value ?? true)
          setDebugForcedVariables(newForced)
        }
      }
    },
    [debugVariableIndexes, debugForcedVariables, setDebugForcedVariables, debuggerPort],
  )

  const [graphList, _setGraphList] = useState<string[]>([])
  const setGraphList = useCallback(
    (update: string[] | ((prev: string[]) => string[])) => {
      _setGraphList((prev) => {
        const next = typeof update === 'function' ? update(prev) : update
        setDebugGraphList(next)
        return next
      })
    },
    [setDebugGraphList],
  )
  const [isVariablesPanelCollapsed, setIsVariablesPanelCollapsed] = useState(false)

  type PanelMethods = {
    collapse: () => void
    expand: () => void
  } & ImperativePanelHandle

  const panelRef = useRef<ImperativePanelHandle | null>(null)
  const explorerPanelRef = useRef<PanelMethods | null>(null)
  const workspacePanelRef = useRef<PanelMethods | null>(null)
  const consolePanelRef = useRef<PanelMethods | null>(null)
  const [activeTab, setActiveTab] = useState('console')
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
    if (!isPlcLogsVisible) {
      setActiveTab((prev) => (prev === 'plc-logs' ? 'console' : prev))
    }
  }, [isPlcLogsVisible])

  useEffect(() => {
    if (isDebuggerVisible) {
      setActiveTab('debug')
    } else {
      setActiveTab((prev) => (prev === 'debug' ? 'console' : prev))
    }
  }, [isDebuggerVisible])

  useEffect(() => {
    const action = isCollapsed ? 'collapse' : 'expand'
    ;[explorerPanelRef, workspacePanelRef, consolePanelRef].forEach((ref) => {
      if (ref.current && typeof ref.current[action] === 'function') {
        ref.current[action]()
      }
    })
  }, [isCollapsed])

  // Load available boards via device port
  useEffect(() => {
    const loadAvailableBoards = async () => {
      try {
        const boardsMap = await device.getAvailableBoards()
        setAvailableOptions({ availableBoards: boardsMap })

        // Default to simulator board if no orchestrator device is connected
        const { runtimeConnection, deviceDefinitions } = useOpenPLCStore.getState()
        const currentBoard = deviceDefinitions.configuration.deviceBoard
        const currentBoardInfo = boardsMap.get(currentBoard)
        if (runtimeConnection.connectionStatus !== 'connected' && currentBoardInfo?.compiler !== 'simulator') {
          setDeviceBoard(SIMULATOR_BOARD_NAME)
        }
      } catch (error) {
        console.error('Failed to load boards data:', error)
      }
    }

    void loadAvailableBoards()
  }, [device, setAvailableOptions, setDeviceBoard])

  return (
    <div className='flex h-full w-full overflow-hidden bg-brand-dark dark:bg-neutral-950'>
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
            id='workspacePanel'
            order={2}
            defaultSize={84}
            className='relative flex h-full min-h-0 w-[400px]'
          >
            <ResizableHandle
              id='workspaceHandle'
              hitAreaMargins={{ coarse: 12, fine: 3 }}
              className='absolute bottom-0 top-0 z-[99] my-[2px] w-[4px] py-2 transition-colors duration-200 data-[resize-handle-active="pointer"]:bg-brand-light data-[resize-handle-state="hover"]:bg-brand-light data-[resize-handle-active="pointer"]:dark:bg-neutral-700  data-[resize-handle-state="hover"]:dark:bg-neutral-700'
            />

            <div id='workspaceContentPanel' className='flex h-full min-h-0 flex-1 grow flex-col gap-2 overflow-hidden'>
              {tabs.length > 0 && <Navigation />}
              <ResizablePanelGroup id='editorPanelGroup' className={`flex h-full gap-2`} direction='vertical'>
                <ResizablePanel
                  id='editorPanel'
                  order={1}
                  minSize={15}
                  defaultSize={69}
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

                  {tabs.length > 0 ? (
                    <>
                      {editor['type'] === 'plc-resource' && <ResourcesEditor />}
                      {editor['type'] === 'plc-device' && <DeviceEditor />}
                      {editor['type'] === 'plc-remote-device' && <RemoteDeviceEditor />}
                      {editor['type'] === 'plc-server' && editor.meta.protocol === 'modbus-tcp' && (
                        <ModbusServerEditor />
                      )}
                      {editor['type'] === 'plc-server' && editor.meta.protocol === 's7comm' && <S7CommServerEditor />}
                      {editor['type'] === 'plc-server' && editor.meta.protocol === 'opcua' && <OpcUaServerEditor />}
                      {editor['type'] === 'plc-datatype' && (
                        <div aria-label='Datatypes editor container' className='flex h-full w-full flex-1 gap-2'>
                          <DataTypeEditor dataTypeName={editor.meta.name} />{' '}
                        </div>
                      )}
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
                        hitAreaMargins={{ coarse: 12, fine: 3 }}
                        style={{ height: '2px', width: 'calc(100% - 16px)' }}
                        className={`absolute bottom-0 left-0 mx-2 transition-colors duration-200 data-[resize-handle-active="pointer"]:bg-brand-light data-[resize-handle-state="hover"]:bg-brand-light data-[resize-handle-active="pointer"]:dark:bg-neutral-700 data-[resize-handle-state="hover"]:dark:bg-neutral-700`}
                      />
                    </>
                  ) : (
                    <p className='mx-auto my-auto flex cursor-default select-none flex-col items-center gap-2 font-display text-xl font-medium'>
                      No tabs open
                    </p>
                  )}
                  <ResizableHandle
                    id='consoleResizeHandle'
                    hitAreaMargins={{ coarse: 12, fine: 3 }}
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
                  className='min-h-0 flex-1 grow rounded-lg border-2 border-neutral-200 bg-white p-4 data-[panel-size="0.0"]:hidden dark:border-neutral-800 dark:bg-neutral-950'
                >
                  <Tabs.Root
                    value={activeTab}
                    onValueChange={setActiveTab}
                    className='relative flex h-full min-h-0 w-full flex-col gap-2 overflow-hidden'
                  >
                    <Tabs.List className='flex h-7 w-64 select-none gap-4'>
                      <Tabs.Trigger
                        value='console'
                        className='h-7 w-16 rounded-md bg-neutral-100 text-xs font-medium text-brand-light data-[state=active]:bg-blue-500 data-[state=active]:text-white dark:bg-neutral-900 dark:text-neutral-700 dark:data-[state=active]:bg-blue-500 dark:data-[state=active]:text-white'
                      >
                        Console
                      </Tabs.Trigger>
                      {isDebuggerVisible && (
                        <Tabs.Trigger
                          value='debug'
                          className='h-7 w-20 rounded-md bg-neutral-100 text-xs font-medium text-brand-light data-[state=active]:bg-blue-500 data-[state=active]:text-white dark:bg-neutral-900 dark:text-neutral-700 dark:data-[state=active]:bg-blue-500 dark:data-[state=active]:text-white'
                        >
                          Debugger
                        </Tabs.Trigger>
                      )}
                      {hasSearchResults && (
                        <Tabs.Trigger
                          value='search'
                          className='h-7 w-16 rounded-md bg-neutral-100 text-xs font-medium text-brand-light data-[state=active]:bg-blue-500 data-[state=active]:text-white dark:bg-neutral-900 dark:text-neutral-700 dark:data-[state=active]:bg-blue-500 dark:data-[state=active]:text-white'
                        >
                          Search
                        </Tabs.Trigger>
                      )}
                      {isPlcLogsVisible && (
                        <Tabs.Trigger
                          value='plc-logs'
                          className='h-7 w-20 rounded-md bg-neutral-100 text-xs font-medium text-brand-light data-[state=active]:bg-blue-500 data-[state=active]:text-white dark:bg-neutral-900 dark:text-neutral-700 dark:data-[state=active]:bg-blue-500 dark:data-[state=active]:text-white'
                        >
                          PLC Logs
                        </Tabs.Trigger>
                      )}
                    </Tabs.List>
                    <Tabs.Content
                      aria-label='Console panel content'
                      value='console'
                      className='flex h-full min-h-0 w-full flex-col overflow-hidden p-2 data-[state=inactive]:hidden'
                    >
                      <ConsoleComponent />
                    </Tabs.Content>
                    {isDebuggerVisible && (
                      <Tabs.Content
                        value='debug'
                        className='debug-panel flex h-full w-full overflow-hidden data-[state=inactive]:hidden'
                      >
                        <ResizablePanelGroup direction='horizontal' className='flex h-full w-full'>
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
                    {hasSearchResults && (
                      <Tabs.Content
                        value='search'
                        className='debug-panel flex  h-full w-full overflow-hidden  data-[state=inactive]:hidden'
                      >
                        <ResizablePanelGroup direction='horizontal' className='flex h-full w-full'>
                          <ResizablePanel minSize={20} defaultSize={100} className='h-full w-full'>
                            <Search items={searchResults} />
                          </ResizablePanel>
                        </ResizablePanelGroup>
                      </Tabs.Content>
                    )}
                    {isPlcLogsVisible && (
                      <Tabs.Content
                        aria-label='PLC Logs panel content'
                        value='plc-logs'
                        className='flex h-full min-h-0 w-full flex-col overflow-hidden p-2 data-[state=inactive]:hidden'
                      >
                        <PlcLogs />
                      </Tabs.Content>
                    )}
                    {activeTab === 'console' && (
                      <div className='absolute right-2 top-1 flex items-center gap-2'>
                        <ConsoleFilters />
                        <ClearConsoleButton />
                      </div>
                    )}
                    {activeTab === 'plc-logs' && (
                      <div className='absolute right-2 top-1 flex items-center gap-2'>
                        <PlcLogsFilters />
                        <ClearConsoleButton
                          onClear={clearPlcLogs}
                          isEmpty={typeof plcLogs === 'string' ? plcLogs.length === 0 : plcLogs.length === 0}
                          label='Clear logs'
                        />
                      </div>
                    )}
                  </Tabs.Root>
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
          </ResizablePanel>
          {ChatPanel && capabilities.hasAIAssistant && isChatOpen && isAIEnabled && hasAIConsented && (
            <>
              <ResizableHandle
                id='chatHandle'
                hitAreaMargins={{ coarse: 12, fine: 3 }}
                className='z-[99] my-[2px] w-[4px] py-2 transition-colors duration-200 data-[resize-handle-active="pointer"]:bg-brand-light data-[resize-handle-state="hover"]:bg-brand-light data-[resize-handle-active="pointer"]:dark:bg-neutral-700 data-[resize-handle-state="hover"]:dark:bg-neutral-700'
              />
              <ResizablePanel
                id='chatPanel'
                order={3}
                defaultSize={16}
                maxSize={25}
                className='min-w-xs relative flex h-full min-h-0 w-full'
              >
                <ChatPanel />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </WorkspaceMainContent>
    </div>
  )
}

export { WorkspaceScreen }
