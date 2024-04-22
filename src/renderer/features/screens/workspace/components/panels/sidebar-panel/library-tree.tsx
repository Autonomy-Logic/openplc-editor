import { BookIcon, FolderIcon, LibraryCloseFolderIcon, MagnifierIcon } from '@process:renderer/assets'
import { LibraryFileIcon } from '@process:renderer/assets/icons/library/File'

import { Header, Tree } from './components'

export const LibraryTree = () => {
  const treeData = [
    {
      key: '0',
      label: 'P1AM_Modules',
      Icon: LibraryCloseFolderIcon,
      title: 'Module Tree',
      children: [
        {
          key: '0.1',
          label: 'P1AM_INIT',
          Icon: LibraryFileIcon,
          title: 'Module Leaf',
          children: [],
        },
        {
          key: '0.2',
          label: 'P1_16CDR',
          Icon: LibraryFileIcon,
          title: 'Module Leaf',
          children: [],
        },
        {
          key: '0.3',
          label: 'P1_08N',
          Icon: LibraryFileIcon,
          title: 'Module Leaf',
          children: [],
        },
        {
          key: '0.4',
          label: 'P1_16N',
          Icon: LibraryFileIcon,
          title: 'Module Leaf',
          children: [],
        },
        {
          key: '0.5',
          label: 'P1_16N',
          Icon: LibraryFileIcon,
          title: 'Module Leaf',
          children: [],
        },
        {
          key: '0.6',
          label: 'P1_08T',
          Icon: LibraryFileIcon,
          title: 'Module Leaf',
          children: [],
        },
        {
          key: '0.7',
          label: 'P1_16TR',
          Icon: LibraryFileIcon,
          title: 'Module Leaf',
          children: [],
        },
        {
          key: '0.8',
          label: 'P1_04AD',
          Icon: LibraryFileIcon,
          title: 'Module Leaf',
          children: [],
        },
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
      children: [],
    },
  ]
  return (
    <div
      className='w-full h-full border-none bg-none flex flex-col pr-1 overflow-x-auto
			[&::-webkit-scrollbar]:bg-neutral-200
		[&::-webkit-scrollbar]:dark:bg-neutral-850
		[&::-webkit-scrollbar-thumb]:bg-brand
		[&::-webkit-scrollbar-thumb]:dark:bg-neutral-700
		[&::-webkit-scrollbar]:hover:h-[6px]
		[&::-webkit-scrollbar]:transition-all
		[&::-webkit-scrollbar]:transition-duration-700
		[&::-webkit-scrollbar]:h-0'
    >
      <Header title='Library' TitleIcon={BookIcon} ButtonIcon={MagnifierIcon} />
      <div
        className='mb-3 overflow-y-auto overflow-x-hidden
			[&::-webkit-scrollbar]:bg-neutral-200
			[&::-webkit-scrollbar]:dark:bg-neutral-850
			[&::-webkit-scrollbar-thumb]:bg-brand
			[&::-webkit-scrollbar-thumb]:dark:bg-neutral-700
			[&::-webkit-scrollbar]:w-1
			'
      >
        <Tree treeData={treeData} />
      </div>
    </div>
  )
}
