import { ReactElement, useMemo, useState } from 'react'

import { useOpenPLCStore } from '../../../store'
import type { BlockVariant } from '../../_atoms/graphical-editor/types/block'
import { getBlockDocumentation } from '../../_atoms/graphical-editor/utils'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../panel'
import { Info } from './info'
import { Library } from './library'
import { Project } from './project'

const Explorer = (): ReactElement => {
  const {
    editor,
    project: {
      data: { pous },
    },
    libraries: { system, user },
  } = useOpenPLCStore()
  // Project enablement: bundled libs (canonical) are always-on; opt-in
  // libs only surface when the project enables them.  Joined here so
  // every consumer below (the filtered list, the documentation
  // lookup) sees the same scoped pool.
  const enabledLibraryNames = useOpenPLCStore((s) => s.enabledLibraries)
  const bundledLibraryNames = useOpenPLCStore((s) => s.bundledLibraryNames)

  const [selectedFileKey, setSelectedFileKey] = useState<string | null>(null)
  const [filterText, setFilterText] = useState<string>('')

  // User Libraries filtering with POU restrictions
  const filteredUserLibraries = user.filter((userLibrary) => {
    if (editor.type === 'plc-textual' || editor.type === 'plc-graphical') {
      if (editor.meta.pouType === 'program') {
        return (
          (userLibrary.type === 'function' || userLibrary.type === 'function-block') &&
          userLibrary.name !== editor.meta.name
        )
      } else if (editor.meta.pouType === 'function') {
        return userLibrary.type === 'function' && userLibrary.name !== editor.meta.name
      } else if (editor.meta.pouType === 'function-block') {
        return (
          (userLibrary.type === 'function' || userLibrary.type === 'function-block') &&
          userLibrary.name !== editor.meta.name
        )
      }
    }

    // Remove userLibrary if its name matches editor.meta.name (fallback case)
    return userLibrary.name !== editor.meta.name
  })

  // System Libraries filtering — restrict to bundled (canonical) +
  // project-enabled, then apply the text/POU-type filter.  Bundled
  // libs are always-on regardless of project enablement.
  const visiblePool = system.filter(
    (library) => bundledLibraryNames.includes(library.name) || enabledLibraryNames.includes(library.name),
  )
  const filteredLibraries = visiblePool.filter((library) =>
    pous.find((pou) => pou.name === editor.meta.name)?.pouType === 'function'
      ? library.pous.some((pou) => pou.name.toLowerCase().includes(filterText) && pou.type === 'function')
      : library.pous.some((pou) => pou.name.toLowerCase().includes(filterText)),
  )

  // Help text for the selected library block — rendered in the bottom
  // Info panel.  Mirrors the graphical-editor tooltip exactly by routing
  // through `getBlockDocumentation` (documentation + INPUT/OUTPUT list),
  // so a block with no prose doc still shows its I/O signature instead of
  // falling back to "No file selected".  System library blocks carry
  // their own `variables`; user-library blocks are project POUs, so we
  // resolve those from `pous` (interface variables + documentation).
  const selectedPouDocumentation = useMemo<string | null>(() => {
    if (!selectedFileKey) return null

    const systemPou = system.flatMap((library) => library.pous).find((pou) => pou.name === selectedFileKey)
    if (systemPou) {
      return getBlockDocumentation({
        documentation: systemPou.documentation,
        variables: systemPou.variables,
      } as unknown as BlockVariant)
    }

    const projectPou = pous.find((pou) => pou.name === selectedFileKey)
    if (projectPou) {
      return getBlockDocumentation({
        documentation: projectPou.documentation ?? '',
        variables: projectPou.interface?.variables ?? [],
      } as unknown as BlockVariant)
    }

    return null
  }, [selectedFileKey, system, pous])

  return (
    <>
      <ResizablePanelGroup id='explorerPanelGroup' direction='vertical' className='h-full flex-1'>
        <ResizablePanel id='projectExplorerPanel' order={1} defaultSize={50} minSize={25} collapsible>
          <Project />
        </ResizablePanel>
        <ResizableHandle
          style={{ height: '1px' }}
          className={`bg-neutral-200 transition-colors duration-200 data-[resize-handle-active='pointer']:bg-brand-light data-[resize-handle-state='hover']:bg-brand-light dark:bg-neutral-850 data-[resize-handle-active='pointer']:dark:bg-neutral-700  data-[resize-handle-state='hover']:dark:bg-neutral-700 `}
        />
        <ResizablePanel id='libraryExplorerPanel' order={2} defaultSize={50} collapsible minSize={20}>
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
    </>
  )
}

export { Explorer }
