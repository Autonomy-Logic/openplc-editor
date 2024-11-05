import { useOpenPLCStore } from '@root/renderer/store'
import { LegacyRef, ReactElement, useState } from 'react'
import { ImperativePanelHandle } from 'react-resizable-panels'

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../panel'
import { Info } from './info'
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
  const {
    editor,
    project: {
      data: { pous },
    },
    libraries: { system },
  } = useOpenPLCStore()

  const [selectedFileKey, setSelectedFileKey] = useState<string | null>(null)
  const [filterText, setFilterText] = useState<string>('')

  const filteredLibraries = system.filter((library) =>
    pous.find((pou) => pou.data.name === editor.meta.name)?.type === 'function'
      ? library.pous.some((pou) => pou.name.toLowerCase().includes(filterText) && pou.type === 'function')
      : library.pous.some((pou) => pou.name.toLowerCase().includes(filterText)),
  )

  const selectedPouDocumentation =
    system
      .flatMap((library: { pous: { name: string; documentation?: string }[] }) => library.pous)
      .find((pou) => pou.name === selectedFileKey)?.documentation || null

  return (
    <ResizablePanel
      ref={collapse}
      id='explorerPanel'
      order={1}
      collapsible={true}
      minSize={13}
      defaultSize={16}
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
          <Library
            filterText={filterText}
            setFilterText={setFilterText}
            selectedFileKey={selectedFileKey}
            setSelectedFileKey={setSelectedFileKey}
            filteredLibraries={filteredLibraries}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
      <Info selectedPouDocumentation={selectedPouDocumentation} />
    </ResizablePanel>
  )
}

export { Explorer }
