import { BookIcon, MagnifierIcon } from '@root/renderer/assets'
import { useOpenPLCStore } from '@root/renderer/store'
import { ReactNode, useState } from 'react'

import { LibraryFile, LibraryFolder, LibraryRoot } from '../../_molecules'

type ILibraryFileProps = {
  label: string
}

type ILibraryFolderProps = {
  label: string
  children?: ReactNode
}

type ILibraryRootProps = {
  children: ReactNode
}

const Library = () => {
  const [selectedFileKey, setSelectedFileKey] = useState<string | null>(null)

  const {
    libraries: { system },
  } = useOpenPLCStore()

  return (
    <div id='library-container' className='flex h-full w-full flex-col pr-2'>
      {/* Actions handler */}
      <div id='library-actions-container' className='relative z-10 my-3 flex w-full justify-normal gap-2 pl-2'>
        <div
          id='library-name-container'
          className='flex h-8 w-full flex-1 cursor-default select-none items-center justify-start gap-1 rounded-lg bg-neutral-100 px-1.5 dark:bg-brand-dark'
        >
          <BookIcon size='sm' />
          <span
            id='project-name'
            className='pl-1 font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-50'
          >
            Library
          </span>
        </div>
        <div id='search-container' className='flex h-8 w-10 items-center justify-center rounded-lg bg-brand'>
          <MagnifierIcon />
        </div>
      </div>
      {/* Data display */}
      <div id='library-tree-container' className='flex h-full w-full flex-col overflow-auto pr-1'>
        <LibraryRoot>
          {system.map((library) => (
            <LibraryFolder key={library.name} label={library.name}>
              {library.pous.map((pou) => (
                <LibraryFile
                  key={pou.name}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/reactflow/ladder-blocks', 'block')
                    e.dataTransfer.setData('application/reactflow/ladder-blocks/library', `system/${library.name}/${pou.name}`)
                  }}
                  label={pou.name}
                  isSelected={selectedFileKey === pou.name}
                  onSelect={() => setSelectedFileKey(pou.name)}
                />
              ))}
            </LibraryFolder>
          ))}
        </LibraryRoot>
      </div>
    </div>
  )
}

export { ILibraryFileProps, ILibraryFolderProps, ILibraryRootProps, Library }
