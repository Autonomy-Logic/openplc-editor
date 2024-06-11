import { ArrowIcon, LibraryCloseFolderIcon, LibraryFileIcon, LibraryOpenFolderIcon } from '@root/renderer/assets'
import { cn } from '@root/utils'
import { ComponentPropsWithoutRef, ReactNode, useCallback, useState } from 'react'

type ILibraryRootProps = ComponentPropsWithoutRef<'ul'> & {
  children: ReactNode
}
const LibraryRoot = ({ children, ...res }: ILibraryRootProps) => {
  return (
    <div>
      <ul className='list-none p-0' {...res}>
        {children}
      </ul>
    </div>
  )
}

type ILibraryFolderProps = ComponentPropsWithoutRef<'li'> & {
  label: string
  children?: ReactNode
}
const LibraryFolder = ({ label, children, ...res }: ILibraryFolderProps) => {
  const [folderIsOpen, setFolderIsOpen] = useState(false)
  const handleFolderVisibility = useCallback(() => setFolderIsOpen(!folderIsOpen), [folderIsOpen])

  return (
    <li className='cursor-pointer aria-expanded:cursor-default ' {...res}>
      <div
        className='flex w-full cursor-pointer flex-row items-center py-1 pl-2 hover:bg-slate-50 dark:hover:bg-neutral-900 '
        onClick={handleFolderVisibility}
      >
        <ArrowIcon
          direction='right'
          className={cn(`h-4 w-4 stroke-brand-light transition-all ${folderIsOpen && 'rotate-270 stroke-brand'}`)}
        />
        {folderIsOpen ? <LibraryOpenFolderIcon size='sm' /> : <LibraryCloseFolderIcon size='sm' />}
        <span
          className={cn(
            'ml-1 truncate font-caption text-xs font-normal text-neutral-850 dark:text-neutral-300',
            folderIsOpen && 'font-medium text-neutral-1000 dark:text-white',
          )}
        >
          {label}
        </span>
      </div>
      {children && folderIsOpen && (
        <div>
          <ul>
            {children && (
              <div>
                <ul className='list-none p-0'>{children}</ul>
              </div>
            )}
          </ul>
        </div>
      )}
    </li>
  )
}

type ILibraryFileProps = ComponentPropsWithoutRef<'li'> & {
  label: string
}

const LibraryFile = ({ label, ...res }: ILibraryFileProps) => {
  const [fileIsSelected, setFileIsSelected] = useState(false)

  const handleLeafSelection = useCallback(() => setFileIsSelected(!fileIsSelected), [fileIsSelected])

  return (
    <li
      onClick={handleLeafSelection}
      className='ml-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-neutral-900'
      {...res}
    >
      <div className='flex flex-row items-center py-1 pl-2 '>
        <LibraryFileIcon size='sm' />
        <span
          className={cn(
            'ml-1 truncate font-caption text-xs font-normal text-neutral-850 dark:text-neutral-300',
            fileIsSelected && 'font-medium text-neutral-1000 dark:text-white',
          )}
        >
          {label}
        </span>
      </div>
    </li>
  )
}

export { LibraryFile, LibraryFolder, LibraryRoot }
