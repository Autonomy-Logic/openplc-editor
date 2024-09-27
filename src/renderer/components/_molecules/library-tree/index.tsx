import { ArrowIcon, LibraryCloseFolderIcon, LibraryFileIcon, LibraryOpenFolderIcon } from '@root/renderer/assets'
import { cn } from '@root/utils'
import { ComponentPropsWithoutRef, ReactNode, useCallback, useEffect, useState } from 'react'

type ILibraryRootProps = ComponentPropsWithoutRef<'ul'> & {
  children: ReactNode
}
const LibraryRoot = ({ children, ...res }: ILibraryRootProps) => {
  return (
    <div>
      <ul className='select-none list-none p-0' {...res}>
        {children}
      </ul>
    </div>
  )
}

type ILibraryFolderProps = ComponentPropsWithoutRef<'li'> & {
  label: string
  children?: ReactNode
  initiallyOpen?: boolean
  shouldBeOpen?: boolean
}
const LibraryFolder = ({ label, children, initiallyOpen, shouldBeOpen }: ILibraryFolderProps) => {
  const [folderIsOpen, setFolderIsOpen] = useState(initiallyOpen || false)

  const handleFolderVisibility = useCallback(() => setFolderIsOpen(!folderIsOpen), [folderIsOpen])

  useEffect(() => {
    if (shouldBeOpen !== undefined) {
      setFolderIsOpen(shouldBeOpen)
    }
  }, [shouldBeOpen])

  const hasFilesAssociated = Array.isArray(children) && children.length > 0

  return (
    <li className='cursor-pointer aria-expanded:cursor-default'>
      <div
        className='flex w-full cursor-pointer flex-row items-center py-1 pl-2 hover:bg-slate-50 dark:hover:bg-neutral-900'
        onClick={hasFilesAssociated ? handleFolderVisibility : undefined}
      >
        {hasFilesAssociated ? (
          <ArrowIcon
            direction='right'
            className={`mr-[6px] h-4 w-4 stroke-brand-light transition-all ${folderIsOpen ? 'rotate-270 stroke-brand' : ''}`}
          />
        ) : (
          <div className='w-[22px]' />
        )}
        {folderIsOpen ? <LibraryOpenFolderIcon size='sm' /> : <LibraryCloseFolderIcon size='sm' />}
        <p
          className={`ml-1 w-full truncate font-caption text-xs font-normal text-neutral-850 dark:text-neutral-300 ${folderIsOpen && 'font-medium text-neutral-1000 dark:text-white'}`}
        >
          {label}
        </p>
      </div>
      {children && folderIsOpen && (
        <div>
          <ul className='list-none p-0'>{children}</ul>
        </div>
      )}
    </li>
  )
}

type ILibraryFileProps = ComponentPropsWithoutRef<'li'> & {
  label: string
  isSelected: boolean
  onSelect: () => void
}

const LibraryFile = ({ label, isSelected, onSelect, ...res }: ILibraryFileProps) => {
  return (
    <li
      className={`${isSelected ? 'bg-slate-50 dark:bg-neutral-900' : ''} ml-2 cursor-pointer pl-2 hover:bg-slate-50 dark:hover:bg-neutral-900`}
      {...res}
    >
      <div className='flex flex-row items-center gap-[6px] py-1 pl-6 '>
        <LibraryFileIcon size='sm' />
        <p
          className={cn(
            'ml-1 w-full truncate font-caption text-xs font-normal text-neutral-850 dark:text-neutral-300',
            isSelected && 'font-medium text-neutral-1000 dark:text-white',
          )}
        >
          {label}
        </p>
      </div>
    </li>
  )
}

export { LibraryFile, LibraryFolder, LibraryRoot }
