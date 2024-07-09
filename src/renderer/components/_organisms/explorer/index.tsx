import { ReactElement } from 'react'

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../panel'
import { Library } from './library'
import { Project } from './project'

/**
 * Renders the Explorer component which consists of a ResizablePanel containing a ProjectExplorer and a LibraryExplorer.
 *
 * @return {ReactElement} The rendered Explorer component
 */
const Explorer = (props): ReactElement => {
  const { prop } = props
  return (
    <ResizablePanel
      ref={prop}
      id='explorerPanel'
      order={1}
      collapsible={true}
      minSize={11}
      defaultSize={13}
      className='flex h-full w-[200px] flex-col overflow-auto rounded-lg border-2 border-inherit border-neutral-200 bg-white data-[panel-size="0.0"]:hidden dark:border-neutral-850 dark:bg-neutral-950'
    >
      <ResizablePanelGroup id='explorerPanelGroup' direction='vertical' className='h-full flex-1'>
        <ResizablePanel id='projectExplorerPanel' order={1} defaultSize={50}>
          <Project />
        </ResizablePanel>
        <ResizableHandle className='bg-neutral-200 dark:bg-neutral-850' />
        <ResizablePanel id='libraryExplorerPanel' order={2} defaultSize={50}>
          {/* The library tree panel will be implemented soon */}
          <Library />
        </ResizablePanel>
      </ResizablePanelGroup>
      <p>Info panel</p>
    </ResizablePanel>
  )
}

export { Explorer }
