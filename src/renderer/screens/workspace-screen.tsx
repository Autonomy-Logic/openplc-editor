import { useNavigate } from 'react-router-dom'

import { DebuggerIcon, DownloadIcon, ExitIcon, PlayIcon, SearchIcon, TransferIcon, ZoomInOut } from '../assets'
import { ActivityBarButton } from '../components/_atoms/buttons'
import { MonacoEditor } from '../components/_features/[workspace]/editor'
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
  return (
    <div className='flex w-full h-full bg-brand-dark dark:bg-neutral-950'>
      <WorkspaceSideContent>
        <div className='w-full h-fit flex flex-col gap-10 my-5'>
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
        <div className='h-20 w-full flex flex-col gap-6'>
          <ActivityBarButton aria-label='Exit' onClick={() => navigate('/')}>
            <ExitIcon />
          </ActivityBarButton>
        </div>
      </WorkspaceSideContent>
      <WorkspaceMainContent>
        <ResizablePanelGroup id='mainContentPanelGroup' direction='horizontal' className='w-full h-full'>
          <Explorer />
          <ResizableHandle className='mr-2' />
          <ResizablePanel id='workspacePanel' order={2} defaultSize={87} className='h-full w-[400px]'>
            <div id='workspaceContentPanel' className='flex-1 grow h-full overflow-hidden flex flex-col gap-2'>
              {tabs.length > 0 && <Navigation />}
              <ResizablePanelGroup id='editorPanelGroup' direction='vertical'>
                <ResizablePanel
                  id='editorPanel'
                  order={1}
                  defaultSize={75}
                  className='flex-1 grow rounded-lg overflow-hidden flex flex-col border-2 border-neutral-200 bg-white dark:bg-neutral-950 dark:border-neutral-800 p-4'
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
                        className='flex flex-1 flex-col gap-4 w-full h-full'
                      >
                        {/**
                         * TODO: refactor the variable component
                         */}
                        {/* <Variables /> */}
                      </ResizablePanel>
                      <ResizableHandle className='h-[1px] bg-brand-light w-full' />
                      <ResizablePanel
                        id='textualEditorPanel'
                        order={2}
                        defaultSize={75}
                        className='flex-1 flex-grow rounded-md mt-6'
                      >
                        <MonacoEditor />
                      </ResizablePanel>
                    </ResizablePanelGroup>
                  ) : (
                    <p className='mx-auto my-auto text-xl flex flex-col items-center gap-1 font-medium font-display cursor-default select-none'>
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
                  className='flex-1 grow border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 rounded-lg border-2 data-[panel-size="0.0"]:hidden'
                >
                  <span>Console</span>
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
