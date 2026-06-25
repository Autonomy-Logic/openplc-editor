import { MagnifierIcon } from '@root/frontend/assets/icons/interface/Magnifier'
import { useOpenPLCStore } from '@root/frontend/store'
import { buildLibraryTree, type LibraryTreeNode } from '@root/frontend/utils/library-tree'
import type { SystemLibraryPou } from '@root/middleware/shared/ports/library-types'
import { useState } from 'react'

import { InputWithRef } from '../../../../../../../_atoms/input'
import { LibraryFile, LibraryFolder, LibraryRoot } from '../../../../../../../_molecules/library-tree'
import { useBoundPou } from '../../../active-context'

export const ModalBlockLibrary = ({
  selectedFileKey,
  setSelectedFileKey,
}: {
  selectedFileKey: string | null
  setSelectedFileKey: (string: string) => void
}) => {
  const pouName = useBoundPou()
  const {
    project: {
      data: { pous },
    },
    libraries: { system, user },
  } = useOpenPLCStore()
  // Scope the visible system pool to bundled (canonical) +
  // project-enabled libraries — same gate the FBD picker and the
  // explorer's library tree use.
  const enabledLibraryNames = useOpenPLCStore((s) => s.enabledLibraries)
  const bundledLibraryNames = useOpenPLCStore((s) => s.bundledLibraryNames)

  const [filterText, setFilterText] = useState('')

  const visiblePool = system.filter(
    (library) => bundledLibraryNames.includes(library.name) || enabledLibraryNames.includes(library.name),
  )
  const systemLibraries = visiblePool.filter((library) =>
    pous.find((pou) => pou.name === pouName)?.pouType === 'function'
      ? library.pous.some((pou) => pou.name.toLowerCase().includes(filterText) && pou.type === 'function')
      : library.pous.some((pou) => pou.name.toLowerCase().includes(filterText)),
  )
  const userLibraries = user.filter((library) =>
    pous.find((pou) => pou.name === pouName)?.pouType === 'function'
      ? library.type === 'function' && library.name.toLowerCase().includes(filterText)
      : library.name.toLowerCase().includes(filterText),
  )

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFilterText(e.target.value.toLowerCase())
  }

  const inputStyle =
    'border dark:bg-neutral-900 dark:text-neutral-100 dark:border-neutral-850 h-[30px] w-full rounded-lg border-neutral-300 px-[10px] text-xs text-neutral-700 outline-none focus:border-brand'

  return (
    <>
      <div className={`relative flex items-center focus-within:border-brand ${inputStyle}`}>
        <InputWithRef
          className='h-full w-full bg-inherit outline-none'
          id='Search-File'
          placeholder='Search'
          type='text'
          value={filterText}
          onChange={handleFilterChange}
        />
        <label className='relative right-0 stroke-brand' htmlFor='Search-File'>
          <MagnifierIcon size='sm' className='stroke-brand' />
        </label>
      </div>
      <div className='border-neural-100 h-[388px] w-full rounded-lg border px-1 py-4 dark:border-neutral-850'>
        <div className='h-full w-full overflow-auto'>
          <LibraryRoot>
            {systemLibraries.map((library) => {
              const isFunctionEditor = pous.find((p) => p.name === pouName)?.pouType === 'function'
              const tree = buildLibraryTree(library, (pou) => {
                if (!pou.name.toLowerCase().includes(filterText)) return false
                if (isFunctionEditor && pou.type !== 'function') return false
                return true
              })
              return (
                <LibraryFolder
                  key={library.name}
                  label={tree.label}
                  initiallyOpen={false}
                  shouldBeOpen={filterText.length > 0}
                >
                  {tree.children.map((child, idx) =>
                    renderModalTreeNode(child, library.name, {
                      filterText,
                      selectedFileKey,
                      setSelectedFileKey,
                      keySuffix: `${library.name}-${idx}`,
                    }),
                  )}
                </LibraryFolder>
              )
            })}
            <LibraryFolder
              key={'user'}
              label={'User Libraries'}
              initiallyOpen={false}
              shouldBeOpen={filterText.length > 0}
            >
              {userLibraries
                .filter((library) => library.name.toLowerCase().includes(filterText))
                .map((library) => (
                  <LibraryFile
                    key={library.name}
                    label={library.name}
                    isSelected={selectedFileKey === library.name}
                    onSelect={() => setSelectedFileKey(`user/${library.name}`)}
                    onClick={() => setSelectedFileKey(`user/${library.name}`)}
                  />
                ))}
            </LibraryFolder>
          </LibraryRoot>
        </div>
      </div>
    </>
  )
}

/**
 * Render one node of a system-library category tree inside the
 * Ladder block-picker modal. Mirrors the FBD modal renderer — kept
 * inline rather than extracted to a shared module because the
 * resulting two short helpers are easier to follow than a shared
 * abstraction with its own prop surface.
 */
function renderModalTreeNode(
  node: LibraryTreeNode,
  libraryName: string,
  ctx: {
    filterText: string
    selectedFileKey: string | null
    setSelectedFileKey: (key: string) => void
    keySuffix: string
  },
): React.ReactNode {
  if (node.kind === 'folder') {
    return (
      <LibraryFolder
        key={`${ctx.keySuffix}-${node.label}`}
        label={node.label}
        initiallyOpen={false}
        shouldBeOpen={ctx.filterText.length > 0}
      >
        {node.children.map((child, idx) =>
          renderModalTreeNode(child, libraryName, {
            ...ctx,
            keySuffix: `${ctx.keySuffix}-${idx}`,
          }),
        )}
      </LibraryFolder>
    )
  }
  const pou: SystemLibraryPou = node.pou
  const fileKey = `system/${libraryName}/${pou.name}`
  return (
    <LibraryFile
      key={`${ctx.keySuffix}-${pou.name}`}
      label={pou.name}
      isSelected={ctx.selectedFileKey === pou.name}
      onSelect={() => ctx.setSelectedFileKey(fileKey)}
      onClick={() => ctx.setSelectedFileKey(fileKey)}
    />
  )
}
