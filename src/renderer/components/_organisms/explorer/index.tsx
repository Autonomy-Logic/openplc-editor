import { LegacyRef, ReactElement } from 'react'
import { ImperativePanelHandle } from 'react-resizable-panels'

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../panel'
import { Library } from './library'
import { Project } from './project'

/**
 * Renders the Explorer component which consists of a ResizablePanel containing a ProjectExplorer and a LibraryExplorer.
 *
 * @return {ReactElement} The rendered Explorer component
 */

type explorerProps = {
  collapse: LegacyRef<ImperativePanelHandle> | undefined
}

const Explorer = ({ collapse }: explorerProps): ReactElement => {
  return (
    <ResizablePanel
      ref={collapse}
      id='explorerPanel'
      order={1}
      collapsible={true}
      minSize={11}
      defaultSize={13}
      maxSize={80}
      className='flex h-full w-[200px] flex-col overflow-auto rounded-lg border-2 border-inherit border-neutral-200 bg-white data-[panel-size="0.0"]:hidden dark:border-neutral-850 dark:bg-neutral-950'
    >
      <ResizablePanelGroup id='explorerPanelGroup' direction='vertical' className='h-full flex-1'>
        <ResizablePanel id='projectExplorerPanel' order={1} defaultSize={40} minSize={25} collapsible>
          <Project />
        </ResizablePanel>
        <ResizableHandle
          style={{ height: '1px' }}
          className={`bg-neutral-200  transition-colors  duration-200  data-[resize-handle-active="pointer"]:bg-brand-light  data-[resize-handle-state="hover"]:bg-brand-light dark:bg-neutral-850 data-[resize-handle-active="pointer"]:dark:bg-neutral-700  data-[resize-handle-state="hover"]:dark:bg-neutral-700 `}
        />
        <ResizablePanel id='libraryExplorerPanel' order={2} defaultSize={40} collapsible minSize={20}>
          <Library />
        </ResizablePanel>
      </ResizablePanelGroup>
      <div className='flex h-36 w-full flex-col p-2'>
        <p className='h-full w-full rounded-lg border-[1.5px] border-brand bg-inherit p-1'>Info panel</p>
      </div>
    </ResizablePanel>
  )
}

export { Explorer }
