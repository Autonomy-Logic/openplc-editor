import { OpenFolderIcon } from '~renderer/assets'
import { Header, Tree } from './components'
import { LibraryFileIcon } from '~/renderer/assets/icons/library/LibraryFile'

export const LibraryTree = () => {
	const treeData = [
		{
			key: '0',
			label: 'P1AM_Modules',
			Icon: OpenFolderIcon,
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
			Icon: OpenFolderIcon,
			title: 'Module Tree',
			children: [],
		},
		{
			key: '2',
			label: 'Arduino',
			Icon: OpenFolderIcon,
			title: 'Module Tree',
			children: [],
		},
		{
			key: '3',
			label: 'Communication',
			Icon: OpenFolderIcon,
			title: 'Module Tree',
			children: [],
		},
		{
			key: '4',
			label: 'Sequent Microsystems',
			Icon: OpenFolderIcon,
			title: 'Module Tree',
			children: [],
		},
	]
	return (
		<div className='w-full h-[55%] border-none bg-none overflow-auto flex flex-col'>
			<Header title='Library' />
			<Tree treeData={treeData} />
		</div>
	)
}
