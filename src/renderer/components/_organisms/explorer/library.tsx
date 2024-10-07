import { BookIcon, CloseIcon, MagnifierIcon } from '@root/renderer/assets'
import { useOpenPLCStore } from '@root/renderer/store'
import { ReactNode, useEffect, useRef, useState } from 'react'

import { InputWithRef } from '../../_atoms'
import { parsePouToStText } from '../../_features/[workspace]/editor/monaco/drag-and-drop/st'
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

type LibraryProps = {
  filteredLibraries: {
    name: string
    pous: {
      name: string
      language: string
      type: string
      body: string
      documentation: string
      variables: {
        name: string
        class: string
        type: { definition: string; value: string }
      }[]
    }[]
  }[]
  setSelectedFileKey: (key: string) => void
  selectedFileKey: string | null
  filterText: string
  setFilterText: (text: string) => void
}

const Library = ({  filterText, setFilterText, setSelectedFileKey, selectedFileKey , filteredLibraries }: LibraryProps) => {
  const {
    editor: { type, meta },
  } = useOpenPLCStore()

  const [isSearchActive, setIsSearchActive] = useState(false)
  const [shouldRenderInput, setShouldRenderInput] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (isSearchActive) {
      setShouldRenderInput(true)
      setTimeout(() => inputRef.current?.focus(), 0)
    } else {
      const timer = setTimeout(() => {
        setShouldRenderInput(false)
      }, 500)

      return () => clearTimeout(timer)
    }
  }, [isSearchActive])

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFilterText(e.target.value.toLowerCase())
  }

  return (
    <div id='library-container' className='flex h-full w-full flex-col pr-2'>
      {/* Actions handler */}
      <div id='library-actions-container' className='relative z-10 my-3 flex w-full justify-normal gap-2 pl-2'>
        <div
          id='library-name-container'
          className='flex h-8 w-full flex-1 cursor-default select-none items-center justify-start rounded-lg bg-neutral-100 px-1.5 dark:bg-brand-dark'
        >
          <BookIcon size='sm' />
          <span
            id='project-name'
            className={`transition-[width,opacity, ml] overflow-hidden pl-1 font-caption text-xs font-medium text-neutral-1000 duration-500 ease-in-out dark:text-neutral-50 ${
              isSearchActive ? 'ml-0 w-0 opacity-0' : 'ml-1 w-[60px] opacity-100'
            }`}
          >
            Library
          </span>
        </div>

        <div
          id='search-container'
          className={`relative flex h-8 items-center justify-start overflow-hidden rounded-lg transition-all duration-500 ease-in-out ${
            isSearchActive ? 'w-full' : 'w-10'
          }`}
        >
          {shouldRenderInput && (
            <div
              className={`absolute left-0 flex w-full items-center justify-between bg-neutral-100 transition-opacity duration-500 ease-in-out dark:bg-brand-dark ${
                isSearchActive ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <InputWithRef
                id='Search-File'
                type='text'
                placeholder='Search'
                className='h-8 w-full bg-neutral-100 px-2 font-caption text-xs font-medium focus:outline-none dark:bg-brand-dark'
                value={filterText}
                onChange={handleFilterChange}
                ref={inputRef}
              />
            </div>
          )}
          <div className='absolute right-0 flex h-8 w-10 flex-shrink-0 items-center justify-center bg-brand'>
            {isSearchActive ? (
              <CloseIcon
                className='w-4 cursor-pointer stroke-white'
                onClick={() => {
                  setFilterText('')
                  setIsSearchActive(false)
                }}
              />
            ) : (
              <MagnifierIcon
                className='w-6 cursor-pointer'
                onClick={() => {
                  setIsSearchActive(!isSearchActive)
                  setFilterText('')
                }}
              />
            )}
          </div>
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
              {library.pous
                .filter((pou) => pou.name.toLowerCase().includes(filterText))
                .map((pou) => (
                  <LibraryFile
                    key={pou.name}
                    label={pou.name}
                    onClick={() => setSelectedFileKey(pou.name)}
                    onSelect={() => setSelectedFileKey(pou.name)}
                    isSelected={selectedFileKey === pou.name}
                    draggable
                    onDragStart={(e) => {
                      if (type === 'plc-textual')
                        e.dataTransfer.setData('text/plain', meta.language === 'st' ? parsePouToStText(pou) : pou.body)
                      else if (type === 'plc-graphical') {
                        if (meta.language === 'ld') {
                          e.dataTransfer.setData('application/reactflow/ladder-blocks', 'block')
                        }
                        e.dataTransfer.setData('application/library', `system/${library.name}/${pou.name}`)
                      }
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
