import { FolderIcon, PlusIcon } from '@root/renderer/assets'
import {
	ProjectTreeRoot,
	ProjectTreeBranch,
	ProjectTreeLeaf,
} from '@components/_molecules/project-tree'
import { useOpenPLCStore } from '@root/renderer/store'
import { IPouTemplate } from '@root/types/transfer'

const ProjectExplorer = () => {
	const {
		data: { pous },
		updateEditor,
		updateTabs,
	} = useOpenPLCStore()
	const Name = 'Project Name'

	const handleCreateTab = (tab: IPouTemplate) => {
		updateTabs(tab)
		updateEditor({ path: tab.name, value: tab.body })
	}
	return (
		<>
			{/* Actions handler */}
			<div className='select-none flex justify-around w-[200px] my-3 px-2'>
				<div className='flex items-center justify-start px-1.5 w-32 h-8 gap-1 rounded-lg cursor-default select-none bg-neutral-100 dark:bg-brand-dark'>
					<FolderIcon size='sm' />
					<span className='pl-1 font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-50'>
						{Name}
					</span>
				</div>
				<button
					type='button'
					className='w-10 h-8 rounded-lg bg-brand flex justify-center items-center'
				>
					<PlusIcon className='stroke-white' />
				</button>
			</div>
			{/* Data display */}
			{/* Work in progress: Do not change the structure */}
			<ProjectTreeRoot label={Name}>
				<ProjectTreeBranch branchTarget='dataType' />
				<ProjectTreeBranch branchTarget='function'>
					{pous
						?.filter((pou) => pou.type === 'function')
						.map((pou) => (
							<ProjectTreeLeaf
								key={pou.name}
								leafLang={pou.language}
								label={pou.name}
								onClick={() => handleCreateTab(pou)}
							/>
						))}
				</ProjectTreeBranch>
				<ProjectTreeBranch branchTarget='functionBlock'>
					{pous
						?.filter((pou) => pou.type === 'functionBlock')
						.map((pou) => (
							<ProjectTreeLeaf
								key={pou.name}
								leafLang={pou.language}
								label={pou.name}
								onClick={() => handleCreateTab(pou)}
							/>
						))}
				</ProjectTreeBranch>
				<ProjectTreeBranch branchTarget='program'>
					{pous
						?.filter((pou) => pou.type === 'program')
						.map((pou) => (
							<ProjectTreeLeaf
								key={pou.name}
								leafLang={pou.language}
								label={pou.name}
								onClick={() => handleCreateTab(pou)}
							/>
						))}
				</ProjectTreeBranch>
				<ProjectTreeBranch branchTarget='device'>
					{/** Will be filled with device */}
				</ProjectTreeBranch>
				{/** Maybe a divider component */}
				{/* <ProjectTreeBranch branchTarget='' label='Resources' /> */}
			</ProjectTreeRoot>
		</>
	)
}
export { ProjectExplorer }
