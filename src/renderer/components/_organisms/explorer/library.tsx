import { BookIcon, MagnifierIcon } from '@root/renderer/assets'
import { useOpenPLCStore } from '@root/renderer/store'
import { ReactNode, useState } from 'react'

import { InputWithRef } from '../../_atoms'
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
  const {
    libraries: { system },
  } = useOpenPLCStore()

  const [selectedFileKey, setSelectedFileKey] = useState<string | null>(null)
  const [isSearchActive, setIsSearchActive] = useState(false)
  const [filterText, setFilterText] = useState('')

  const filteredLibraries = system.filter((library) =>
    library.pous.some((pou) => pou.name.toLowerCase().includes(filterText)),
  )

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFilterText(e.target.value.toLowerCase())
  }

  return (
    <div id='library-container' className='flex h-full w-full flex-col pr-2'>
      {/* Actions handler */}
      <div id='library-actions-container' className='relative z-10 my-3 flex w-full justify-normal gap-2 pl-2'>
        <div
          id='library-name-container'
          className='flex h-8 w-full flex-1 cursor-default select-none items-center justify-start gap-1 rounded-lg bg-neutral-100 px-1.5 dark:bg-brand-dark'
        >
          <BookIcon size='sm' />
          {!isSearchActive && (
            <span
              id='project-name'
              className='pl-1 font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-50'
            >
              Library
            </span>
          )}
        </div>

        <div id='search-container' className='flex h-8 items-center justify-center rounded-lg bg-brand'>
          {isSearchActive && (
            <InputWithRef
              id='Search-File'
              type='text'
              placeholder='Search'
              className='h-8 w-full flex-grow rounded-s-lg bg-neutral-100 px-2 focus:outline-none dark:bg-brand-dark'
              onBlur={() => setIsSearchActive(false)}
              value={filterText}
              onChange={handleFilterChange}
            />
          )}
          <MagnifierIcon className='w-10' onClick={() => setIsSearchActive(!isSearchActive)} />
        </div>
      </div>
      {/* Data display */}
      <div id='library-tree-container' className='flex h-full w-full flex-col overflow-auto pr-1'>
        <LibraryRoot>
          {filteredLibraries.map((library) => (
            <LibraryFolder
              key={library.name}
              label={library.name}
              initiallyOpen={false}
              shouldBeOpen={filterText.length > 0}
            >
              {library.pous.map((pou) => (
                <LibraryFile
                  key={pou.name}
                  label={pou.name}
                  isSelected={selectedFileKey === pou.name}
                  onSelect={() => setSelectedFileKey(pou.name)}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', pou.body)
                  }}
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
