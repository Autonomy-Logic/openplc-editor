import { ReactElement } from 'react'

import { ResizableHandle,ResizablePanel, ResizablePanelGroup } from '../panel'
import { Project } from './project'

/**
 * Renders the Explorer component which consists of a ResizablePanel containing a ProjectExplorer and a LibraryExplorer.
 *
 * @return {ReactElement} The rendered Explorer component
 */
const Explorer = (): ReactElement => {
  return (
    <ResizablePanel
      id='explorerPanel'
      order={1}
      collapsible={true}
      minSize={11}
      defaultSize={13}
      className='flex flex-col h-full w-[200px] border-inherit rounded-lg overflow-auto border-2 data-[panel-size="0.0"]:hidden border-neutral-200 dark:border-neutral-850 bg-white dark:bg-neutral-950'
    >
      <ResizablePanelGroup id='explorerPanelGroup' direction='vertical' className='flex-1 h-full'>
        <ResizablePanel id='projectExplorerPanel' order={1} defaultSize={50}>
          <Project />
        </ResizablePanel>
        <ResizableHandle className='bg-neutral-200 dark:bg-neutral-850' />
        <ResizablePanel id='libraryExplorerPanel' order={2} defaultSize={50}>
          {/* The library tree panel will be implemented soon */}
          <span>Will be implemented soon</span>
        </ResizablePanel>
      </ResizablePanelGroup>
      <p>Info panel</p>
    </ResizablePanel>
  )
}

export { Explorer }
