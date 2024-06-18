import { BookIcon, LibraryCloseFolderIcon, LibraryFileIcon, MagnifierIcon } from '@root/renderer/assets'
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

  const treeData = [
    {
      key: '0',
      label: 'P1AM_Modules',
      Icon: LibraryCloseFolderIcon,
      title: 'Module Tree',
      children: [
        { key: '0.1', label: 'P1AM_INIT', Icon: LibraryFileIcon, title: 'Module Leaf', children: 'some text' },
        { key: '0.2', label: 'P1_16CDR', Icon: LibraryFileIcon, title: 'Module Leaf', children: '' },
        { key: '0.3', label: 'P1_08N', Icon: LibraryFileIcon, title: 'Module Leaf', children: '' },
        { key: '0.4', label: 'P1_16N', Icon: LibraryFileIcon, title: 'Module Leaf', children: '' },
        { key: '0.5', label: 'P1_16N', Icon: LibraryFileIcon, title: 'Module Leaf', children: '' },
        { key: '0.6', label: 'P1_08T', Icon: LibraryFileIcon, title: 'Module Leaf', children: '' },
        { key: '0.7', label: 'P1_16TR', Icon: LibraryFileIcon, title: 'Module Leaf', children: '' },
        { key: '0.8', label: 'P1_04AD', Icon: LibraryFileIcon, title: 'Module Leaf', children: '' },
      ],
    },
    {
      key: '1',
      label: 'Jaguar',
      Icon: LibraryCloseFolderIcon,
      title: 'Module Tree',
      children: [],
    },
    {
      key: '2',
      label: 'Arduino',
      Icon: LibraryCloseFolderIcon,
      title: 'Module Tree',
      children: [],
    },
    {
      key: '3',
      label: 'Communication',
      Icon: LibraryCloseFolderIcon,
      title: 'Module Tree',
      children: [],
    },
    {
      key: '4',
      label: 'Sequent Microsystems',
      Icon: LibraryCloseFolderIcon,
      title: 'Module Tree',
      children: [
        { key: '0.1', label: 'P1AM_INIT', Icon: LibraryFileIcon, title: 'Module Leaf', children: [] },
        { key: '0.2', label: 'P1_16CDR', Icon: LibraryFileIcon, title: 'Module Leaf', children: [] },
      ],
    },
  ]

  console.log(' selectedFileKey', selectedFileKey)

  return (
    <div className='w-full'>
      <div id='library-actions-container' className='relative z-10 my-3 flex w-full justify-normal gap-2 px-2'>
        <div
          id='library-name-container'
          className='flex h-8 w-full flex-1 cursor-default select-none items-center justify-start gap-1 rounded-lg bg-neutral-100 px-1.5 dark:bg-brand-dark'
        >
          <BookIcon size='sm' />
          <span id='project-name' className='pl-1 font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-50'>
            Library
          </span>
        </div>
        <div id='search-container' className='flex h-8 w-10 items-center justify-center rounded-lg bg-brand'>
          <MagnifierIcon />
        </div>
      </div>
      <LibraryRoot>
        {treeData.map((data) => (
          <LibraryFolder key={data.key} label={data.label} title={data.title}>
            {data.children.map((child) => (
              <LibraryFile
                key={child.key}
                label={child.label}
                isSelected={selectedFileKey === child.key}
                onSelect={() => setSelectedFileKey(child.key)}
              />
            ))}
          </LibraryFolder>
        ))}
      </LibraryRoot>
     
    </div>
  );
};

export { ILibraryFileProps, ILibraryFolderProps, ILibraryRootProps, Library }
