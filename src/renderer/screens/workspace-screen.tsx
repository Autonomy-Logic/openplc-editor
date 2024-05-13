import _ from 'lodash'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

import { DebuggerIcon, DownloadIcon, ExitIcon, PlayIcon, SearchIcon, TransferIcon, ZoomInOut } from '../assets'
import { ActivityBarButton } from '../components/_atoms/buttons'
import { toast } from '../components/_features/[app]/toast/use-toast'
import { MonacoEditor } from '../components/_features/[workspace]/editor'
import { Explorer } from '../components/_organisms/explorer'
import { Navigation } from '../components/_organisms/navigation'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../components/_organisms/panel'
import { WorkspaceMainContent, WorkspaceSideContent } from '../components/_templates'
import { useOpenPLCStore } from '../store'

const WorkspaceScreen = () => {
  const navigate = useNavigate()
  const {
    tabs,
    projectData,
    projectPath,
    editingState,
    workspaceActions: { setEditingState },
  } = useOpenPLCStore()

  useEffect(() => {
    const handleSaveProject = async () => {
      const { success, reason } = await window.bridge.saveProject({ projectPath, projectData })
      if (success) {
        _.debounce(() => setEditingState('saved'), 1000)()
        toast({
          title: 'Changes saved!',
          description: 'The project was saved successfully!',
          variant: 'default',
        })
      } else {
        _.debounce(() => setEditingState('unsaved'), 1000)()
        toast({
          title: 'Error in the save request!',
          description: reason.description,
          variant: 'fail',
        })
      }
    }

    if (editingState === 'save-request') {
      void handleSaveProject()
    }
  }, [editingState])

  window.bridge.saveProjectAccelerator((_event) => {
    setEditingState('save-request')
    toast({
      title: 'Save changes',
      description: 'Trying to save the changes in the project file.',
      variant: 'warn',
    })
  })

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
                  className='flex-1 grow rounded-lg border-2 border-neutral-200 bg-white data-[panel-size="0.0"]:hidden dark:border-neutral-800 dark:bg-neutral-950'
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
