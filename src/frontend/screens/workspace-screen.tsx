import * as Tabs from '@radix-ui/react-tabs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ImperativePanelHandle } from 'react-resizable-panels'
import { useShallow } from 'zustand/react/shallow'

import { projectCapabilities } from '../../middleware/shared/ports/types'
import {
  useCapabilities,
  useChatPanel,
  useDebugger,
  useDevice,
  usePlatform,
  useProject,
} from '../../middleware/shared/providers'
import { ExitIcon } from '../assets/icons/interface/Exit'
import { ClearConsoleButton } from '../components/_atoms/buttons/console/clear-console'
import { BranchStatusBar } from '../components/_features/[workspace]/branches'
import { DataTypeEditor } from '../components/_features/[workspace]/data-type'
import { DeviceEditor } from '../components/_features/[workspace]/editor/device'
import { EtherCATDeviceEditor, EtherCATEditor } from '../components/_features/[workspace]/editor/device/ethercat'
import { RemoteDeviceEditor } from '../components/_features/[workspace]/editor/device/remote-device'
import { DiffViewerEditor } from '../components/_features/[workspace]/editor/diff-viewer'
import { GraphicalEditor } from '../components/_features/[workspace]/editor/graphical'
import { LibraryManagerEditor } from '../components/_features/[workspace]/editor/library-manager'
import { LibraryManifestEditor } from '../components/_features/[workspace]/editor/library-manifest'
import { MonacoEditor } from '../components/_features/[workspace]/editor/monaco'
import { PackageManagerEditor } from '../components/_features/[workspace]/editor/package-manager'
import { ResourcesEditor } from '../components/_features/[workspace]/editor/resource-editor'
import { ModbusServerEditor } from '../components/_features/[workspace]/editor/server/modbus-server'
import { OpcUaServerEditor } from '../components/_features/[workspace]/editor/server/opcua-server'
import { S7CommServerEditor } from '../components/_features/[workspace]/editor/server/s7comm-server'
import { VendorScreenEditor } from '../components/_features/[workspace]/editor/vendor-screen'
import { Search } from '../components/_features/[workspace]/search'
import { SourceControlPanel } from '../components/_features/[workspace]/source-control'
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
import {
  useDebugBoolValuesMap,
  useDebugForcedVariablesMap,
  useDebugNonBoolValuesMap,
  useIsDebuggerVisible,
} from '../hooks/use-debug-value'
import { useRuntimePolling } from '../hooks/use-runtime-polling'
import { forceDebugVariable, releaseDebugVariable } from '../services/debug-force-variable'
import { useOpenPLCStore } from '../store'
import { cn } from '../utils/cn'
import { toast } from '../utils/toast'

const WorkspaceScreen = () => {
  const capabilities = useCapabilities()
  const ChatPanel = useChatPanel()
  const debuggerPort = useDebugger()
  const device = useDevice()
  const project = useProject()

  // STABLE: action references (never change)
  const { toggleCollapse, clearPlcLogs, toggleDebugExpandedNode, setDebugGraphList } = useOpenPLCStore(
    useCallback((s) => s.workspaceActions, []),
  )
  const { setAvailableOptions } = useOpenPLCStore(useCallback((s) => s.deviceActions, []))
  const addLog = useOpenPLCStore(useCallback((s) => s.consoleActions.addLog, []))

  // RARE: UI state (changes on user interaction, not during debug polling)
  const tabs = useOpenPLCStore(useCallback((s) => s.tabs, []))
  const editor = useOpenPLCStore(useCallback((s) => s.editor, []))
  // Every open editor model (POU + data type + singletons).  POU
  // editors (textual / graphical) and data-type editors are
  // multi-mounted: one React subtree per entry, visibility toggled
  // by CSS.  This keeps Monaco / ReactFlow instances alive across
  // tab switches — no dispose churn, no view-state loss.
  const editors = useOpenPLCStore(useCallback((s) => s.editors, []))
  const searchResults = useOpenPLCStore(useCallback((s) => s.searchResults, []))
  const pous = useOpenPLCStore(useCallback((s) => s.project.data.pous, []))
  const projectPath = useOpenPLCStore(useCallback((s) => s.project.meta.path, []))
  const projectType = useOpenPLCStore(useCallback((s) => s.project.meta.type, []))
  // Project-type capability matrix.  Combines with `capabilities`
  // (host platform features) below to decide what affordances render
  // in this workspace shell.
  const projectCaps = projectCapabilities({ type: projectType })

  // RARE: workspace UI + debug session state (grouped with shallow)
  const {
    isCollapsed,
    isPlcLogsVisible,
    plcLogs,
    debugVariableTree,
    debugVariableIndexes,
    debugExpandedNodes,
    fbSelectedInstance,
    fbDebugInstances,
  } = useOpenPLCStore(
    useShallow((s) => ({
      isCollapsed: s.workspace.isCollapsed,
      isPlcLogsVisible: s.workspace.isPlcLogsVisible,
      plcLogs: s.workspace.plcLogs,
      debugVariableTree: s.workspace.debugVariableTree,
      debugVariableIndexes: s.workspace.debugVariableIndexes,
      debugExpandedNodes: s.workspace.debugExpandedNodes,
      fbSelectedInstance: s.workspace.fbSelectedInstance,
      fbDebugInstances: s.workspace.fbDebugInstances,
    })),
  )

  // RARE: AI state (grouped with shallow)
  const {
    isChatOpen,
    isEnabled: isAIEnabled,
    hasConsented: hasAIConsented,
  } = useOpenPLCStore(
    useShallow((s) => ({
      isChatOpen: s.ai.isChatOpen,
      isEnabled: s.ai.isEnabled,
      hasConsented: s.ai.hasConsented,
    })),
  )

  // Version control state
  const { activePanel, pendingChangesCount } = useOpenPLCStore(
    useShallow((s) => ({
      activePanel: s.versionControl.activePanel,
      pendingChangesCount: s.versionControl.pendingChangesCount,
    })),
  )
  const { setActivePanel } = useOpenPLCStore(useCallback((s) => s.versionControlActions, []))
  const sharedWorkspaceActions = useOpenPLCStore(useCallback((s) => s.sharedWorkspaceActions, []))

  const isDebuggerVisible = useIsDebuggerVisible()
  const debugBoolValues = useDebugBoolValuesMap()
  const debugNonBoolValues = useDebugNonBoolValuesMap()
  const debugForcedVariables = useDebugForcedVariablesMap()

  // Version control is an intersection: the host must support it
  // (web edition has its own VC adapter; desktop has git) AND the
  // project type must allow it.  Library projects ship without VC
  // for now — git-on-library is plausible but out of scope and
  // would re-introduce the same UI churn we just removed.
  const hasVersionControl = capabilities.hasVersionControl && projectCaps.hasVersionControl

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

            const variableValue = debugBoolValues.get(compositeKey) ?? debugNonBoolValues.get(compositeKey)
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
    [pous, debugBoolValues, debugNonBoolValues, fbSelectedInstance, fbDebugInstances],
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
      variableType: string,
      value?: boolean,
      valueBuffer?: Uint8Array,
      lookupKey?: string,
    ): Promise<void> => {
      const keyForIndexLookup = lookupKey ?? compositeKey
      const variableIndex = debugVariableIndexes.get(keyForIndexLookup)
      if (variableIndex === undefined) return

      if (!debuggerPort.isConnected()) return

      if (value === undefined && valueBuffer === undefined) {
        await releaseDebugVariable(debuggerPort, compositeKey, variableIndex)
      } else {
        const buffer = valueBuffer ?? new Uint8Array([value ? 1 : 0])
        // Pass variableType so the wire-endianness swap inside the
        // service knows whether to skip swapping (BOOL one-byte
        // paths, STRING / WSTRING) — see services/debug-force-variable.
        await forceDebugVariable(debuggerPort, compositeKey, variableIndex, buffer, value ?? true, variableType)
      }
    },
    [debugVariableIndexes, debuggerPort],
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

  const handleBranchSwitch = useCallback(
    async (branchName: string) => {
      if (!projectPath) return
      try {
        const result = await project.openProjectByPath(projectPath)
        if (result.success && result.data) {
          sharedWorkspaceActions.handleOpenProjectResponse(result.data)
          toast({
            title: 'Branch switched',
            description: `Now on branch: ${branchName}`,
            variant: 'default',
          })
        } else {
          toast({
            title: 'Failed to reload project',
            description: 'The branch was switched but the project could not be reloaded.',
            variant: 'fail',
          })
        }
      } catch (error) {
        console.error('[WorkspaceScreen] Failed to switch branch:', error)
        toast({
          title: 'Failed to switch branch',
          description: error instanceof Error ? error.message : 'Unknown error',
          variant: 'fail',
        })
      }
    },
    [projectPath, project, sharedWorkspaceActions],
  )

  type PanelMethods = {
    collapse: () => void
    expand: () => void
  } & ImperativePanelHandle

  const panelRef = useRef<ImperativePanelHandle | null>(null)
  const leftPanelRef = useRef<PanelMethods | null>(null)
  const workspacePanelRef = useRef<PanelMethods | null>(null)
  const consolePanelRef = useRef<PanelMethods | null>(null)
  const [activeTab, setActiveTab] = useState('console')
  const consoleFollowRequestId = useOpenPLCStore((state) => state.followRequestId)
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
    ;[leftPanelRef, workspacePanelRef, consolePanelRef].forEach((ref) => {
      if (ref.current && typeof ref.current[action] === 'function') {
        ref.current[action]()
      }
    })
  }, [isCollapsed])

  // A build (or other producer) requested the console: reveal the console
  // panel and switch to the Console tab. The console component handles the
  // kick-to-bottom off the same nonce. Skip the initial value (0) so we never
  // force the console open on first render.
  useEffect(() => {
    if (consoleFollowRequestId === 0) return
    consolePanelRef.current?.expand()
    setActiveTab('console')
  }, [consoleFollowRequestId])

  // Load available boards via device port.
  // `setAvailableOptions` owns the alias sync — once the boards land,
  // target-capability resolution becomes accurate and the device slice
  // re-syncs aliases for the active target. We respect the board saved
  // in the project (no override on load).
  useEffect(() => {
    const loadAvailableBoards = async () => {
      try {
        const boardsMap = await device.getAvailableBoards()
        setAvailableOptions({ availableBoards: boardsMap })
      } catch (error) {
        console.error('Failed to load boards data:', error)
      }
    }

    void loadAvailableBoards()
  }, [device, setAvailableOptions])

  // Subscribe to VPP package events via the packages port
  const packagesPort = usePlatform().packages
  useEffect(() => {
    if (!packagesPort) return

    const unsubOpen = packagesPort.onOpenManager(() => {
      const { tabsActions, editorActions } = useOpenPLCStore.getState()
      const tab = {
        name: 'Package Manager',
        path: '/package-manager',
        elementType: { type: 'package-manager' as const },
      }
      tabsActions.updateTabs(tab)
      const existing = editorActions.getEditorFromEditors(tab.name)
      if (!existing) {
        const model = { type: 'plc-package-manager' as const, meta: { name: 'Package Manager' } }
        editorActions.addModel(model)
        editorActions.setEditor(model)
      } else {
        editorActions.setEditor(existing)
      }
    })

    const unsubBoards = packagesPort.onBoardsUpdated(() => {
      void device.getAvailableBoards().then((boardsMap) => {
        setAvailableOptions({ availableBoards: boardsMap })
      })
    })

    return () => {
      unsubOpen()
      unsubBoards()
    }
  }, [packagesPort, device, setAvailableOptions])

  // Desktop security safeguard: whenever a project opens, re-verify the
  // signatures of every installed VPP package and drop any that no longer
  // validate (a locally-crafted/unsigned .vpp can bypass the signed import
  // flow). Each removal is surfaced as a WARNING in the console panel; the
  // main process emits `packages:boards-updated` on removal, so the board
  // list refreshes via the subscription above. On web `packagesPort` is
  // undefined (packages are backend-provided), so this is a no-op.
  useEffect(() => {
    if (!packagesPort || !projectPath) return
    let cancelled = false
    void packagesPort.verifyInstalledSignatures().then((removed) => {
      if (cancelled) return
      for (const packageId of removed) {
        addLog({
          id: crypto.randomUUID(),
          level: 'warning',
          message: `Removed untrusted VPP package "${packageId}": its signature is missing or invalid.`,
        })
      }
    })
    return () => {
      cancelled = true
    }
  }, [packagesPort, projectPath, addLog])

  return (
    <div className='flex h-full w-full flex-col overflow-hidden bg-brand-dark dark:bg-neutral-950'>
      <div className='flex min-h-0 flex-1 overflow-hidden'>
        <WorkspaceSideContent>
          <WorkspaceActivityBar
            defaultActivityBar={{
              zoom: {
                onClick: () => void toggleCollapse(),
              },
            }}
            explorer={
              hasVersionControl
                ? {
                    isActive: activePanel === 'explorer',
                    onClick: () => setActivePanel('explorer'),
                  }
                : undefined
            }
            sourceControl={
              hasVersionControl
                ? {
                    isActive: activePanel === 'source-control',
                    pendingCount: pendingChangesCount,
                    onClick: () => setActivePanel('source-control'),
                  }
                : undefined
            }
          />
        </WorkspaceSideContent>
        <WorkspaceMainContent>
          <ResizablePanelGroup
            id='mainContentPanelGroup'
            direction='horizontal'
            className='relative flex h-full w-full'
          >
            {/* The left panel must stay mounted across context switches: swapping
                the ResizablePanel itself makes react-resizable-panels rebuild the
                layout from defaultSize and re-normalize, growing the sidebar on
                every switch. Only the children swap. */}
            <ResizablePanel
              ref={leftPanelRef}
              id='leftPanel'
              order={1}
              collapsible={true}
              minSize={13}
              defaultSize={16}
              maxSize={80}
              className="flex h-full w-full max-w-lg flex-col overflow-auto rounded-lg border-2 border-inherit border-neutral-200 bg-white data-[panel-size='0.0']:hidden dark:border-neutral-850 dark:bg-neutral-950"
            >
              {hasVersionControl && activePanel === 'source-control' ? (
                <SourceControlPanel projectId={projectPath} />
              ) : (
                <Explorer />
              )}
            </ResizablePanel>
            <ResizableHandle
              id='workspaceHandle'
              hitAreaMargins={{ coarse: 12, fine: 3 }}
              className='z-[99] my-[2px] w-[4px] py-2 transition-colors duration-200 data-[resize-handle-active="pointer"]:bg-brand-light data-[resize-handle-state="hover"]:bg-brand-light data-[resize-handle-active="pointer"]:dark:bg-neutral-700 data-[resize-handle-state="hover"]:dark:bg-neutral-700'
            />
            <ResizablePanel
              id='workspacePanel'
              order={2}
              defaultSize={68}
              minSize={50}
              className='flex h-full min-h-0 overflow-hidden'
            >
              <div
                id='workspaceContentPanel'
                className='flex h-full min-h-0 flex-1 grow flex-col gap-2 overflow-hidden'
              >
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
                        {/* Singleton editor types — at most one tab per project,
                            so single-mount on the active editor is fine.  Each
                            remounts on tab switch, which is harmless because
                            they don't carry per-instance Monaco / ReactFlow
                            state that would be lost. */}
                        {editor['type'] === 'plc-resource' && <ResourcesEditor />}
                        {editor['type'] === 'plc-device' && <DeviceEditor />}
                        {editor['type'] === 'plc-remote-device' && editor.meta.protocol === 'ethercat' && (
                          <EtherCATEditor />
                        )}
                        {editor['type'] === 'plc-remote-device' && editor.meta.protocol !== 'ethercat' && (
                          <RemoteDeviceEditor />
                        )}
                        {editor['type'] === 'plc-server' && editor.meta.protocol === 'modbus-tcp' && (
                          <ModbusServerEditor />
                        )}
                        {editor['type'] === 'plc-server' && editor.meta.protocol === 's7comm' && <S7CommServerEditor />}
                        {editor['type'] === 'plc-server' && editor.meta.protocol === 'opcua' && <OpcUaServerEditor />}
                        {editor['type'] === 'plc-vendor-screen' && <VendorScreenEditor />}
                        {editor['type'] === 'plc-package-manager' && <PackageManagerEditor />}
                        {editor['type'] === 'plc-library-manager' && <LibraryManagerEditor />}
                        {editor['type'] === 'plc-library-manifest' && <LibraryManifestEditor />}
                        {editor['type'] === 'diff-viewer' && <DiffViewerEditor />}

                        {/* EtherCAT device editors — multi-instance (one tab
                            per `deviceId`).  Kept mounted across tab switches
                            so the device's view state (active tab pane,
                            scroll position, etc.) survives.  `busName` and
                            `deviceId` are passed as props so each instance
                            reads its own device regardless of which tab is
                            active. */}
                        {editors
                          .filter((m) => m.type === 'plc-ethercat-device')
                          .map((model) => {
                            const isActive =
                              editor.type === 'plc-ethercat-device' && editor.meta.deviceId === model.meta.deviceId
                            return (
                              <div key={model.meta.deviceId} className={cn('h-full w-full', !isActive && 'hidden')}>
                                <EtherCATDeviceEditor busName={model.meta.busName} deviceId={model.meta.deviceId} />
                              </div>
                            )
                          })}

                        {/* Data type editors — multi-instance (one tab per
                            data type).  Kept mounted across tab switches.
                            DataTypeEditor reads its own data type by name
                            from the project slice, so multi-mount is safe. */}
                        {editors.some((m) => m.type === 'plc-datatype') && (
                          <div
                            aria-label='Datatypes editor container'
                            className={cn(
                              'flex h-full w-full flex-1 gap-2',
                              editor.type !== 'plc-datatype' && 'hidden',
                            )}
                          >
                            {editors
                              .filter((m) => m.type === 'plc-datatype')
                              .map((model) => {
                                const isActive = editor.type === 'plc-datatype' && editor.meta.name === model.meta.name
                                return (
                                  <div key={model.meta.name} className={cn('h-full w-full', !isActive && 'hidden')}>
                                    <DataTypeEditor dataTypeName={model.meta.name} />
                                  </div>
                                )
                              })}
                          </div>
                        )}

                        {/* POU editors (textual + graphical) — multi-instance.
                            One ResizablePanelGroup shared by every POU so the
                            variables-panel splitter position is consistent;
                            inside, every POU's `VariablesEditor` and body
                            editor stay mounted, with CSS toggling visibility.
                            Eliminates the dispose-during-tab-switch error chain
                            (WordHighlighter, InstantiationService, etc.) and
                            preserves Monaco cursor / ReactFlow viewport for free. */}
                        {editors.some((m) => m.type === 'plc-textual' || m.type === 'plc-graphical') && (
                          <div
                            className={cn(
                              'flex h-full w-full flex-1',
                              editor.type !== 'plc-textual' && editor.type !== 'plc-graphical' && 'hidden',
                            )}
                          >
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
                                {editors
                                  .filter((m) => m.type === 'plc-textual' || m.type === 'plc-graphical')
                                  .map((model) => {
                                    const isActive = editor.meta.name === model.meta.name
                                    return (
                                      <div key={model.meta.name} className={cn('h-full w-full', !isActive && 'hidden')}>
                                        <VariablesEditor name={model.meta.name} isActive={isActive} />
                                      </div>
                                    )
                                  })}
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
                                {editors
                                  .filter((m) => m.type === 'plc-textual' || m.type === 'plc-graphical')
                                  .map((model) => {
                                    const isActive = editor.meta.name === model.meta.name
                                    return (
                                      <div key={model.meta.name} className={cn('h-full w-full', !isActive && 'hidden')}>
                                        {model.type === 'plc-textual' ? (
                                          <MonacoEditor
                                            name={model.meta.name}
                                            language={model.meta.language}
                                            path={model.meta.path}
                                            isActive={isActive}
                                          />
                                        ) : (
                                          <GraphicalEditor
                                            name={model.meta.name}
                                            language={model.meta.language}
                                            isActive={isActive}
                                          />
                                        )}
                                      </div>
                                    )
                                  })}
                              </ResizablePanel>
                            </ResizablePanelGroup>
                          </div>
                        )}
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
                                debugBoolValues={debugBoolValues}
                                debugNonBoolValues={debugNonBoolValues}
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
                  defaultSize={30}
                  minSize={20}
                  maxSize={50}
                  className='relative flex h-full min-h-0 w-full'
                >
                  <ChatPanel />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </WorkspaceMainContent>
      </div>
      {hasVersionControl && projectPath && (
        <BranchStatusBar projectId={projectPath} onBranchSwitch={handleBranchSwitch} />
      )}
    </div>
  )
}

export { WorkspaceScreen }
