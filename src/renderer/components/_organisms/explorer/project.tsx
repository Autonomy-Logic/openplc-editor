import { FolderIcon, PlusIcon } from '@root/renderer/assets'
import {
	ProjectTreeRoot,
	ProjectTreeBranch,
	ProjectTreeLeaf,
} from '@components/_molecules/project-tree'
import { useOpenPLCStore } from '@root/renderer/store'

const ProjectExplorer = () => {
	const { data } = useOpenPLCStore()
	const Name = 'Project Name'

	return (
		<div>
			{/* Actions handler */}
			<div className='flex justify-around w-[200px] my-3 px-2'>
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
			<ProjectTreeRoot label={Name}>
				<ProjectTreeBranch branchTarget='dataType'>
					<ProjectTreeLeaf leafLang='DT' />
				</ProjectTreeBranch>
				<ProjectTreeBranch branchTarget='function'>
					{data.pous
						?.filter((pou) => pou.type === 'function')
						.map((pou) => (
							<ProjectTreeLeaf
								key={pou.name}
								leafLang={pou.language}
								label={pou.name}
							/>
						))}
				</ProjectTreeBranch>
				<ProjectTreeBranch branchTarget='functionBlock'>
					{data.pous
						?.filter((pou) => pou.type === 'functionBlock')
						.map((pou) => (
							<ProjectTreeLeaf
								key={pou.name}
								leafLang={pou.language}
								label={pou.name}
							/>
						))}
				</ProjectTreeBranch>
				<ProjectTreeBranch branchTarget='program'>
					{data.pous
						?.filter((pou) => pou.type === 'program')
						.map((pou) => (
							<ProjectTreeLeaf
								key={pou.name}
								leafLang={pou.language}
								label={pou.name}
							/>
						))}
				</ProjectTreeBranch>
				<ProjectTreeBranch branchTarget='device'>
					{/** Will be filled with device */}
				</ProjectTreeBranch>
				{/** Maybe a divider component */}
				<ProjectTreeLeaf leafLang='RES' label='Resources' />
			</ProjectTreeRoot>
		</div>
	)
}
export { ProjectExplorer }
