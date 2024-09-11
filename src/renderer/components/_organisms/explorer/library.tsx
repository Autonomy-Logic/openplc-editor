import { BookIcon, MagnifierIcon } from '@root/renderer/assets'
import { StandardFunctionBlocks } from '@root/renderer/data/library/standard-function-blocks'
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
          <LibraryFolder label='Standard Function Blocks'>
            {StandardFunctionBlocks.pous.map((block) => (
              <LibraryFile
                key={block.name}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', block.body)
                }}
                label={block.name}
                isSelected={selectedFileKey === block.name}
                onSelect={() => setSelectedFileKey(block.name)}
              />
            ))}
          </LibraryFolder>
          {/* {treeData.map((data) => (
          <LibraryFolder key={data.key} label={data.label} title={data.title}>
          {data.children.map((child) => (
            <LibraryFile
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', child.children)
              }}
              key={child.key}
              label={child.label}
              isSelected={selectedFileKey === child.key}
              onSelect={() => setSelectedFileKey(child.key)}
              />
              ))}
              </LibraryFolder>
              ))} */}
        </LibraryRoot>
      </div>
    </div>
  )
}

export { ILibraryFileProps, ILibraryFolderProps, ILibraryRootProps, Library }
