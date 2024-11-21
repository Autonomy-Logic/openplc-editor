import { useOpenPLCStore } from '@root/renderer/store'
import { LegacyRef, ReactElement, useState } from 'react'
import { ImperativePanelHandle } from 'react-resizable-panels'

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../panel'
import { Info } from './info'
import { Library } from './library'
import { Project } from './project'

type ExplorerProps = {
  collapse: LegacyRef<ImperativePanelHandle> | undefined
}

const Explorer = ({ collapse }: ExplorerProps): ReactElement => {
  const {
    editor,
    project: {
      data: { pous },
    },
    libraries: { system, user },
  } = useOpenPLCStore()

  const [selectedFileKey, setSelectedFileKey] = useState<string | null>(null)
  const [filterText, setFilterText] = useState<string>('')

  // User Libraries filtering with POU restrictions
  const filteredUserLibraries = user.filter((userLibrary) => {
    if (editor.type === 'plc-textual' || editor.type === 'plc-graphical') {
      if (editor.meta.pouType === 'program') {
        return userLibrary.type === 'function' || userLibrary.type === 'function-block'
      } else if (editor.meta.pouType === 'function') {
        return userLibrary.type === 'function'
      } else if (editor.meta.pouType === 'function-block') {
        return userLibrary.type === 'function' || userLibrary.type === 'function-block'
      }
    }
    return false
  })

  // System Libraries filtering with type and text filter
  const filteredLibraries = system.filter((library) =>
    pous.find((pou) => pou.data.name === editor.meta.name)?.type === 'function'
      ? library.pous.some((pou) => pou.name.toLowerCase().includes(filterText) && pou.type === 'function')
      : library.pous.some((pou) => pou.name.toLowerCase().includes(filterText)),
  )

  const selectedPouDocumentation =
    system
      .flatMap((library: { pous: { name: string; documentation?: string }[] }) => library.pous)
      .find((pou) => pou.name === selectedFileKey)?.documentation || null

  console.log('AQUI AS LIBRARYS', filteredUserLibraries)
  console.log('AQUI AS POUS', pous)
  console.log('AQUI AS editor', editor)
  console.log('AQUI AS SYSTEN', system)

  return (
    <ResizablePanel
      ref={collapse}
      id='explorerPanel'
      order={1}
      collapsible={true}
      minSize={13}
      defaultSize={16}
      maxSize={80}
      className="flex h-full w-[200px] flex-col overflow-auto rounded-lg border-2 border-inherit border-neutral-200 bg-white data-[panel-size='0.0']:hidden dark:border-neutral-850 dark:bg-neutral-950"
    >
      <ResizablePanelGroup id='explorerPanelGroup' direction='vertical' className='h-full flex-1'>
        <ResizablePanel id='projectExplorerPanel' order={1} defaultSize={40} minSize={25} collapsible>
          <Project />
        </ResizablePanel>
        <ResizableHandle
          style={{ height: '1px' }}
          className={`bg-neutral-200 transition-colors duration-200 data-[resize-handle-active='pointer']:bg-brand-light data-[resize-handle-state='hover']:bg-brand-light dark:bg-neutral-850 data-[resize-handle-active='pointer']:dark:bg-neutral-700  data-[resize-handle-state='hover']:dark:bg-neutral-700 `}
        />
        <ResizablePanel id='libraryExplorerPanel' order={2} defaultSize={40} collapsible minSize={20}>
          <Library
            filterText={filterText}
            setFilterText={setFilterText}
            selectedFileKey={selectedFileKey}
            setSelectedFileKey={setSelectedFileKey}
            filteredLibraries={filteredLibraries}
            filteredUserLibraries={filteredUserLibraries}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
      <Info selectedPouDocumentation={selectedPouDocumentation} />
    </ResizablePanel>
  )
}

export { Explorer }
