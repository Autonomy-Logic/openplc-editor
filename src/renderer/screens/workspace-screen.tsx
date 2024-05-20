import * as Tabs from '@radix-ui/react-tabs'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { DebuggerIcon, DownloadIcon, ExitIcon, PlayIcon, SearchIcon, TransferIcon, ZoomInOut } from '../assets'
// import NextIcon from '../assets/icons/interface/Next'
import { ActivityBarButton } from '../components/_atoms/buttons'
import { MonacoEditor } from '../components/_features/[workspace]/editor'
import ConsolePanel from '../components/_molecules/console'
import LineGraph from '../components/_molecules/debugger/charts/lineGraph'
import VariablePanel from '../components/_molecules/debugger/variablePanel'
import Header from '../components/_molecules/header'
import { Explorer } from '../components/_organisms/explorer'
import { Navigation } from '../components/_organisms/navigation'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../components/_organisms/panel'
import { WorkspaceMainContent, WorkspaceSideContent } from '../components/_templates'
import { useOpenPLCStore } from '../store'

const WorkspaceScreen = () => {
  const navigate = useNavigate()
  const {
    tabsState: { tabs },
  } = useOpenPLCStore()

  const [isPaused, setIsPaused] = useState(false)
  const [range, setRange] = useState(10)
  const [data, setData] = useState(false)

  const updateRange = (value: number) => {
    if (value > 100) {
      setRange(100)
    } else {
      setRange(value)
    }
  }

  return (
    <div className='flex h-full w-full bg-brand-dark dark:bg-neutral-950'>
      <WorkspaceSideContent>
        <div className='my-5 flex h-fit w-full flex-col gap-10'>
          <ActivityBarButton aria-label='Search'>
            <SearchIcon />
          </ActivityBarButton>
          <ActivityBarButton aria-label='Zoom'>
            <ZoomInOut />
          </ActivityBarButton>
          <ActivityBarButton aria-label='Download'>
            <DownloadIcon />
          </ActivityBarButton>
          <ActivityBarButton aria-label='Transfer'>
            <TransferIcon />
          </ActivityBarButton>
          <ActivityBarButton aria-label='Debugger'>
            <DebuggerIcon />
          </ActivityBarButton>
          <ActivityBarButton aria-label='Play'>
            <PlayIcon />
          </ActivityBarButton>
        </div>
        <div className='flex h-20 w-full flex-col gap-6'>
          <ActivityBarButton aria-label='Exit' onClick={() => navigate('/')}>
            <ExitIcon />
          </ActivityBarButton>
        </div>
      </WorkspaceSideContent>
      <WorkspaceMainContent>
        <ResizablePanelGroup id='mainContentPanelGroup' direction='horizontal' className='h-full w-full'>
          <Explorer />
          <ResizableHandle className='mr-2' />
          <ResizablePanel id='workspacePanel' order={2} defaultSize={87} className='h-full w-[400px]'>
            <div id='workspaceContentPanel' className='flex h-full flex-1 grow flex-col gap-2 overflow-hidden'>
              {tabs.length > 0 && <Navigation />}
              <ResizablePanelGroup id='editorPanelGroup' direction='vertical'>
                <ResizablePanel
                  id='editorPanel'
                  order={1}
                  defaultSize={75}
                  className='flex flex-1 grow flex-col overflow-hidden rounded-lg border-2 border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950'
                >
                  {tabs.length > 0 ? (
                    <ResizablePanelGroup
                      id='editorContentPanelGroup'
                      direction='vertical'
                      className='flex flex-1 flex-col gap-2'
                    >
                      <ResizablePanel
                        id='variableTablePanel'
                        order={1}
                        collapsible
                        collapsedSize={0}
                        minSize={20}
                        defaultSize={25}
                        className='flex h-full w-full flex-1 flex-col gap-4'
                      >
                        {/**
                         * TODO: refactor the variable component
                         */}
                        {/* <Variables /> */}
                      </ResizablePanel>
                      <ResizableHandle className='h-[1px] w-full bg-brand-light' />
                      <ResizablePanel
                        id='textualEditorPanel'
                        order={2}
                        defaultSize={75}
                        className='mt-6 flex-1 flex-grow rounded-md'
                      >
                        <MonacoEditor />
                      </ResizablePanel>
                    </ResizablePanelGroup>
                  ) : (
                    <p className='mx-auto my-auto flex cursor-default select-none flex-col items-center gap-1 font-display text-xl font-medium'>
                      No tabs open
                    </p>
                  )}
                </ResizablePanel>
                <ResizableHandle className='mt-2' />
                <ResizablePanel
                  id='consolePanel'
                  order={2}
                  collapsible
                  defaultSize={25}
                  minSize={15}
                  className='flex-1 grow  rounded-lg border-2 border-neutral-200 bg-white p-4 data-[panel-size="0.0"]:hidden dark:border-neutral-800 dark:bg-neutral-950'
                >
                  <Tabs.Root defaultValue='console' className='flex h-full w-full flex-col gap-2 overflow-hidden'>
                    <Tabs.List className='flex  h-7 w-64 gap-4'>
                      <Tabs.Trigger
                        value='console'
                        className='h-7 w-16 rounded-md bg-neutral-100 text-xs font-medium text-brand-light data-[state=active]:bg-blue-500 data-[state=active]:text-white dark:bg-neutral-900  dark:text-neutral-700'
                      >
                        Console
                      </Tabs.Trigger>
                      <Tabs.Trigger
                        value='debug'
                        className='h-7 w-16 rounded-md bg-neutral-100 text-xs font-medium text-brand-light data-[state=active]:bg-blue-500 data-[state=active]:text-white dark:bg-neutral-900  dark:text-neutral-700'
                      >
                        Debugger
                      </Tabs.Trigger>
                    </Tabs.List>
                    <Tabs.Content
                      value='console'
                      className='console-panel h-full w-full overflow-hidden p-2 data-[state=inactive]:hidden'
                    >
                      <ConsolePanel />
                    </Tabs.Content>
                    <Tabs.Content
                      value='debug'
                      className='debug-panel flex h-full w-full gap-2 overflow-hidden  data-[state=inactive]:hidden'
                    >
                      <div className='w-full'>
                        <div className='flex w-full  flex-col gap-2  rounded-lg border-[0.75px] border-neutral-200 p-2 dark:border-neutral-800 dark:bg-neutral-900'>
                          <div className='header flex justify-between '>
                            <div className='flex gap-4'>
                              <button className='flex h-7 w-[133px] items-center justify-center gap-2 rounded-md bg-neutral-100 text-cp-sm font-medium text-neutral-1000 outline-none dark:bg-brand-dark dark:text-white'>
                                <DebuggerIcon fill='#0464fb' className='h-3 w-3 stroke-brand' /> debugger terminal
                              </button>
                              <div className='flex gap-2'>
                                <input
                                  type='text'
                                  onChange={(e) => updateRange(Number(e.target.value))}
                                  className='h-7 w-9 items-center rounded-md border border-neutral-200 bg-white p-2 text-center text-cp-sm font-medium text-neutral-1000 outline-none dark:bg-neutral-900'
                                />
                                <select className='h-7 w-[88px] rounded-md border border-neutral-200 bg-white outline-none dark:bg-neutral-900'>
                                  <option value='seconds'>seconds</option>
                                </select>
                              </div>
                            </div>

                            <div className='flex gap-2'>
                              <Header isPaused={isPaused} setIsPaused={setIsPaused} />
                            </div>
                          </div>
                          <div className='chart-content  h-full w-full  gap-2 overflow-hidden'>
                            <LineGraph isPaused={isPaused} range={range} value={data} setData={setData} />
                          </div>
                        </div>
                        <div className='flex w-full justify-between p-2 text-cp-base font-semibold text-neutral-1000'>
                          <div>
                            <span>time</span>
                            <p className='font-normal'>0m 0s 0ms</p>
                          </div>
                          <div>
                            <span>ticks</span>
                            <p className='font-normal'>0</p>
                          </div>
                        </div>
                      </div>
                      <VariablePanel />
                    </Tabs.Content>
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
