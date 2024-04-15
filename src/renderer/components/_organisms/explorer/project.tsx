import {
	ArrowIcon,
	FolderIcon,
	FunctionBlockIcon,
	FunctionIcon,
	PlusIcon,
	ProgramIcon,
} from '@root/renderer/assets'
import {
	ProjectTreeRoot,
	ProjectTreeBranch,
	ProjectTreeLeaf,
} from '@components/_molecules/project-tree'
import { useOpenPLCStore } from '@root/renderer/store'
import { IPouTemplate } from '@root/types/transfer'
import {
	Popover,
	PopoverTrigger,
	PopoverContent,
	PouCard,
	PouCardLabel,
	PouCardForm,
} from '../../_molecules'

const Actions = () => {
	const Name = 'Project Name'
	return (
		<Popover>
			<div
				id='project-actions-container'
				className='flex justify-around w-[200px] my-3 px-2 relative z-10'
			>
				<div
					id='project-name-container'
					className='flex items-center justify-start px-1.5 w-32 h-8 gap-1 rounded-lg cursor-default select-none bg-neutral-100 dark:bg-brand-dark'
				>
					<FolderIcon size='sm' />
					<span
						id='project-name'
						className='pl-1 font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-50'
					>
						{Name}
					</span>
				</div>
				<div id='create-pou-container'>
					<PopoverTrigger
						id='create-pou-trigger'
						type='button'
						className='w-10 h-8 rounded-lg bg-brand flex justify-center items-center'
					>
						<PlusIcon className='stroke-white' />
					</PopoverTrigger>
				</div>

				<PopoverContent
					alignOffset={-7}
					sideOffset={10}
					align='end'
					className='w-[188px] h-fit shadow-card dark:shadow-dark-card border border-brand-light dark:border-brand-medium-dark bg-white dark:bg-neutral-950 p-2 rounded-lg flex flex-col gap-2'
				>
					<Popover>
						<PopoverTrigger id='create-function-trigger'>
							<div
								id='create-function-trigger-container'
								className='data-[state=open]:bg-neutral-100 py-[2px] px-[6px] justify-between dark:data-[state=open]:bg-neutral-900 relative flex items-center w-full h-7 gap-[6px] rounded-md cursor-pointer select-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
							>
								<FunctionIcon size='md' />
								<p className='text-start font-caption text-xs font-normal text-neutral-1000 dark:text-neutral-300 flex-1 my-[2px]'>
									Function
								</p>
								<ArrowIcon size='md' direction='right' />
							</div>
						</PopoverTrigger>
						<PopoverContent
							id='create-function-content'
							sideOffset={14}
							alignOffset={-7}
							align='start'
							side='right'
						>
							<PouCard>
								<PouCardLabel type='function' />
								<PouCardForm type='function' />
							</PouCard>
						</PopoverContent>
					</Popover>
					<Popover>
						<PopoverTrigger id='create-function-block-trigger'>
							<div
								id='create-function-block-trigger-container'
								className='data-[state=open]:bg-neutral-100 py-[2px] px-[6px] justify-between dark:data-[state=open]:bg-neutral-900 relative flex items-center w-full h-7 gap-[6px] rounded-md cursor-pointer select-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
							>
								<FunctionBlockIcon size='md' />
								<p className='text-start font-caption text-xs font-normal text-neutral-1000 dark:text-neutral-300 flex-1 my-[2px]'>
									Function Block
								</p>
								<ArrowIcon size='md' direction='right' />
							</div>
						</PopoverTrigger>
						<PopoverContent
							id='create-function-block-content'
							sideOffset={14}
							alignOffset={-7}
							align='start'
							side='right'
						>
							<PouCard>
								<PouCardLabel type='function-block' />
								<PouCardForm type='function-block' />
							</PouCard>
						</PopoverContent>
					</Popover>
					<Popover>
						<PopoverTrigger id='create-program-trigger'>
							<div
								id='create-program-trigger-container'
								className='data-[state=open]:bg-neutral-100 py-[2px] px-[6px] justify-between dark:data-[state=open]:bg-neutral-900 relative flex items-center w-full h-7 gap-[6px] rounded-md cursor-pointer select-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
							>
								<ProgramIcon size='md' />
								<p className='text-start font-caption text-xs font-normal text-neutral-1000 dark:text-neutral-300 flex-1 my-[2px]'>
									Program
								</p>
								<ArrowIcon size='md' direction='right' />
							</div>
						</PopoverTrigger>
						<PopoverContent
							id='create-program-content'
							sideOffset={14}
							alignOffset={-7}
							align='start'
							side='right'
						>
							<PouCard>
								<PouCardLabel type='program' />
								<PouCardForm type='program' />
							</PouCard>
						</PopoverContent>
					</Popover>
				</PopoverContent>
			</div>
		</Popover>
	)
}

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
			<Actions />
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
