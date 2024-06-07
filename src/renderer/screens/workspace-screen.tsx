import * as Tabs from '@radix-ui/react-tabs'
import _ from 'lodash'
import { useEffect } from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { DebuggerIcon, DownloadIcon, ExitIcon, PlayIcon, SearchIcon, TransferIcon, ZoomInOut } from '../assets'
import { ActivityBarButton } from '../components/_atoms/buttons'
import { toast } from '../components/_features/[app]/toast/use-toast'
import { DataTypeEditor, MonacoEditor } from '../components/_features/[workspace]/editor'
import { Console } from '../components/_molecules/console'
import { VariablesPanel } from '../components/_molecules/variables-panel'
import { Debugger } from '../components/_organisms/debugger'
import { Explorer } from '../components/_organisms/explorer'
import { Navigation } from '../components/_organisms/navigation'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../components/_organisms/panel'
// import { VariablesEditor } from '../components/_organisms/variables-editor'
import { WorkspaceMainContent, WorkspaceSideContent } from '../components/_templates'
import { useOpenPLCStore } from '../store'

const GraphicalEditor = () => {
  return <p>This gonna be a graphical editor to handle the graphical languages</p>
}

const WorkspaceScreen = () => {
  const navigate = useNavigate()
  const {
    tabs,
    projectData,
    projectPath,
    editingState,
    editor,
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

  const [graphList, setGraphList] = useState<string[]>([])

  const variables = [
    { name: 'a', type: 'false' },
    { name: 'b', type: 'false' },
    { name: 'c', type: 'false' },
    { name: 'd', type: 'false' },
  ]
  console.log(graphList)
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
            <DebuggerIcon variant='muted' />
          </ActivityBarButton>
          <ActivityBarButton aria-label='Play'>
            <PlayIcon />
          </ActivityBarButton>
        </div>
        <div className='flex h-7 w-full flex-col gap-6'>
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
                  {/**
                   * TODO: Need to be refactored.
                   * Must handle 3 types of editors: Textual editor, data type editor and graphical editor
                   */}
                  {tabs.length > 0 ? (
                    <>
                      {editor['type'] === 'plc-datatype' && (
                        <div aria-label='Datatypes editor container' className='flex h-full w-full flex-1'>
                          <DataTypeEditor derivation={editor['meta']['derivation']} />{' '}
                        </div>
                      )}
                      {editor['type'] === 'plc-graphical' && <GraphicalEditor />}
                      {editor['type'] === 'plc-textual' && (
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
                            className='flex h-full w-full flex-1 flex-col gap-4 overflow-auto'
                          >
                            {/* <VariablesEditor /> */} <p> Here will go the variable table editor</p>
                          </ResizablePanel>
                          <ResizableHandle className='h-[1px] w-full bg-brand-light' />
                          <ResizablePanel
                            id='textualEditorPanel'
                            order={2}
                            defaultSize={75}
                            className='mt-6 flex-1 flex-grow rounded-md'
                          >
                            <MonacoEditor
                              name={editor.meta.name}
                              language={editor.meta.language}
                              path={editor.meta.path}
                            />
                          </ResizablePanel>
                        </ResizablePanelGroup>
                      )}
                    </>
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
                  defaultSize={31}
                  minSize={22}
                  className='flex-1 grow  rounded-lg border-2 border-neutral-200 bg-white p-4 data-[panel-size="0.0"]:hidden dark:border-neutral-800 dark:bg-neutral-950'
                >
                  <Tabs.Root defaultValue='console' className='flex h-full w-full flex-col gap-2 overflow-hidden'>
                    <Tabs.List className='flex h-7 w-64 gap-4'>
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
                      aria-label='Console panel content'
                      value='console'
                      className='h-full w-full overflow-hidden p-2 data-[state=inactive]:hidden'
                    >
                      <Console />
                    </Tabs.Content>
                    <Tabs.Content
                      value='debug'
                      className='debug-panel flex  h-full w-full overflow-hidden  data-[state=inactive]:hidden'
                    >
                      <ResizablePanelGroup direction='horizontal' className='flex h-full  w-full '>
                        <ResizablePanel minSize={20} defaultSize={100} className='h-full w-full'>
                          <Debugger graphList={graphList} />
                        </ResizablePanel>
                        <ResizableHandle className='w-2 bg-transparent' />
                        <ResizablePanel minSize={15} defaultSize={20} className='h-full w-full'>
                          <VariablesPanel variables={variables} graphList={graphList} setGraphList={setGraphList} />
                        </ResizablePanel>
                      </ResizablePanelGroup>
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
