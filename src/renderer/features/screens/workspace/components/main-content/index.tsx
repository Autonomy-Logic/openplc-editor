import { MonacoEditor } from '@root/renderer/components/_features/[workspace]/editor'
import { Explorer } from '@root/renderer/components/_organisms/explorer'
import { Navigation } from '@root/renderer/components/_organisms/navigation'
import { Variables } from '@root/renderer/features/variables'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../../../../resizable'
// import { NavigationPanel } from '../panels/navigation-panel'
// import { InfoPanel } from '../panels/sidebar-panel/info-panel'
// import { LibraryTree } from '../panels/sidebar-panel/library-tree'
// import { ProjectTree } from '../panels/sidebar-panel/project-tree'

export const MainContent = () => {
  const {
    workspaceState: {
      systemConfigs: { OS },
    },
    tabsState: { tabs },
  } = useOpenPLCStore()

  return (
    /* Refactor: This outside div will be replaced by the new <WorkspaceMainContent /> */
    <div
      className={cn(
        'flex h-full w-full flex-1 flex-grow gap-1 bg-neutral-100 p-2 dark:bg-neutral-900',
        `${OS !== 'linux' && '!rounded-tl-lg'}`,
      )}
    >
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
                      <Variables />
                    </ResizablePanel>
                    <ResizableHandle className='h-[1px] w-full bg-brand-light' />
                    <ResizablePanel
                      id='textualEditorPanel'
                      order={2}
                      defaultSize={75}
                      className='mt-6 flex-1 bg-red-500 flex-grow rounded-md'
                    >
                      <MonacoEditor />
                    </ResizablePanel>
                  </ResizablePanelGroup>
                ) : (
                  <p className='mx-auto my-auto cursor-default select-none font-display text-xl font-medium'>
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
    </div>
  )
}
