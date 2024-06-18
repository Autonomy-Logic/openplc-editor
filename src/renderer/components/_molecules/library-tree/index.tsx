import { ArrowIcon, LibraryCloseFolderIcon, LibraryFileIcon, LibraryOpenFolderIcon } from '@root/renderer/assets'
import { cn } from '@root/utils'
import { ComponentPropsWithoutRef, ReactNode, useCallback, useState } from 'react'

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
}
const LibraryFolder = ({ label, children, ...res }: ILibraryFolderProps) => {
  const [folderIsOpen, setFolderIsOpen] = useState(false)
  const handleFolderVisibility = useCallback(() => setFolderIsOpen(!folderIsOpen), [folderIsOpen])
  const hasFilesAssociated = children && children.length > 0

  return (
    <li className='cursor-pointer aria-expanded:cursor-default ' {...res}>
      <div
        className='flex w-full cursor-pointer flex-row items-center py-1 pl-2 hover:bg-slate-50 dark:hover:bg-neutral-900'
        onClick={hasFilesAssociated ? handleFolderVisibility : undefined}
      >
        {hasFilesAssociated ? (
          <ArrowIcon
            direction='right'
            className={cn(
              `mr-[6px] h-4 w-4 stroke-brand-light transition-all ${folderIsOpen && 'rotate-270 stroke-brand'}`,
            )}
          />
        ) : (
          <div className='w-[22px]' />
        )}
        {!folderIsOpen ? <LibraryCloseFolderIcon size='sm' /> : <LibraryOpenFolderIcon size='sm' />}
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
  isSelected: boolean
  onSelect: () => void
}

const LibraryFile = ({ label, isSelected, onSelect, ...res }: ILibraryFileProps) => {
  return (
    <li
      onClick={onSelect}
      className={`${isSelected ? 'bg-slate-50 dark:bg-neutral-900' : ''} ml-2 cursor-pointer pl-2 hover:bg-slate-50 dark:hover:bg-neutral-900`}
      {...res}
    >
      <div className='flex flex-row items-center gap-[6px] py-1 pl-2 '>
        <ArrowIcon direction='right' className={`${!isSelected ? 'stroke-brand-light' : 'stroke-brand'}`} />
        <LibraryFileIcon size='sm' />
        <span
          className={cn(
            'ml-1 truncate font-caption text-xs font-normal text-neutral-850 dark:text-neutral-300',
            isSelected && 'font-medium text-neutral-1000 dark:text-white',
          )}
        >
          {label}
        </span>
      </div>
    </li>
  )
}

export { LibraryFile, LibraryFolder, LibraryRoot }
