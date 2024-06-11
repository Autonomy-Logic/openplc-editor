import { BookIcon, MagnifierIcon } from '@root/renderer/assets'
import { ReactNode } from 'react'

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
  return (
    <div className='w-full'>
      <div id='library-actions-container' className='relative z-10 my-3 flex w-full justify-normal gap-2 px-2'>
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
      <LibraryRoot>
        <LibraryFolder label='Pasta 1'>
          <LibraryFile label='Arquivo 1' />
          <LibraryFile label='Arquivo 2' />
        </LibraryFolder>

        <LibraryFolder label='Pasta 2'>
          <LibraryFile label='Arquivo 3' />
        </LibraryFolder>
      </LibraryRoot>
    </div>
  )
}
export { ILibraryFileProps, ILibraryFolderProps, ILibraryRootProps, Library }
