import { ClearConsoleButton } from '@components/_atoms/buttons/console/clear-console'
import * as Tabs from '@radix-ui/react-tabs'
import { cn } from '@root/utils'
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
import { Navigation } from '../components/_organisms/navigation'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../components/_organisms/panel'
import { VariablesEditor } from '../components/_organisms/variables-editor'
import { WorkspaceActivityBar } from '../components/_organisms/workspace-activity-bar'
import { WorkspaceMainContent, WorkspaceSideContent } from '../components/_templates'
import { useOpenPLCStore } from '../store'

const WorkspaceScreen = () => {
  const {
    tabs,
    workspace: { isCollapsed },
    editor,
    workspaceActions: { toggleCollapse },
    searchResults,
  } = useOpenPLCStore()

  const variables = [
    { name: 'a', type: 'false' },
    { name: 'b', type: 'false' },
    { name: 'c', type: 'false' },
    { name: 'd', type: 'false' },
  ]
  const [graphList, setGraphList] = useState<string[]>([])
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
                      {editor['type'] === 'plc-device' && <DeviceEditor editorDerivation={editor.meta.name} />}
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
                      {/** TODO: Need to be implemented */}
                      {/* <Tabs.Trigger
                        value='debug'
                        className='h-7 w-16 rounded-md bg-neutral-100 text-xs font-medium text-brand-light data-[state=active]:bg-blue-500 data-[state=active]:text-white dark:bg-neutral-900  dark:text-neutral-700'
                      >
                        Debugger
                      </Tabs.Trigger> */}
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
                    <Tabs.Content
                      value='debug'
                      className='debug-panel flex  h-full w-full overflow-hidden  data-[state=inactive]:hidden'
                    >
                      <ResizablePanelGroup direction='horizontal' className='flex h-full w-full '>
                        <ResizablePanel minSize={20} defaultSize={100} className='h-full w-full'>
                          <Debugger graphList={graphList} />
                        </ResizablePanel>
                        <ResizableHandle className='w-2 bg-transparent' />
                        <ResizablePanel minSize={15} defaultSize={20} className='h-full w-full'>
                          <VariablesPanel variables={variables} graphList={graphList} setGraphList={setGraphList} />
                        </ResizablePanel>
                      </ResizablePanelGroup>
                    </Tabs.Content>
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
