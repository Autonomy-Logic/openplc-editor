import {
	BookIcon,
	FolderIcon,
	LibraryCloseFolderIcon,
	MagnifierIcon,
} from '~renderer/assets'
import { Header, Tree } from './components'
import { LibraryFileIcon } from '~/renderer/assets/icons/library/File'

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
		<div className='w-full h-[43%] border-none bg-none flex flex-col'>
			<Header title='Library' TitleIcon={BookIcon} ButtonIcon={MagnifierIcon} />
			<div className='overflow-y-auto overflow-x-hidden'>
				<Tree treeData={treeData} />
			</div>
		</div>
	)
}
