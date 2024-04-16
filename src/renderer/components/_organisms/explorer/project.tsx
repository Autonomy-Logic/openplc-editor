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
import _ from 'lodash'
import { ReactElement } from 'react'

const Project = () => {
	const {
		state: { projectData: { pous } },
		updateEditor,
		updateTabs,
	} = useOpenPLCStore()
	const Name = 'Project Name'

	const handleCreateTab = (tab: IPouTemplate) => {
		updateTabs(tab)
		updateEditor({ path: tab.name, value: tab.body })
	}

	const CreatePouSources: {
		id: number
		label: 'function' | 'function-block' | 'program'
		icon: ReactElement
	}[] = [
		{
			id: 0,
			label: 'function',
			icon: <FunctionIcon size='sm' />,
		},
		{
			id: 1,
			label: 'function-block',
			icon: <FunctionBlockIcon size='sm' />,
		},
		{
			id: 2,
			label: 'program',
			icon: <ProgramIcon size='sm' />,
		},
	]

	return (
		<>
			{/* Actions handler */}
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
						{CreatePouSources.map(({ id, label, icon }) => (
							<Popover key={id}>
								<PopoverTrigger id={`create-${label}-trigger`}>
									<div
										id={`create-${label}-trigger-container`}
										className='data-[state=open]:bg-neutral-100 py-[2px] px-[6px] justify-between dark:data-[state=open]:bg-neutral-900 relative flex items-center w-full h-7 gap-[6px] rounded-md cursor-pointer select-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
									>
										{icon}
										<p className='text-start font-caption text-xs font-normal text-neutral-1000 dark:text-neutral-300 flex-1 my-[2px]'>
											{_.startCase(label)}
										</p>
										<ArrowIcon size='md' direction='right' />
									</div>
								</PopoverTrigger>
								<PopoverContent
									id={`create-${label}-content`}
									sideOffset={14}
									alignOffset={-7}
									align='start'
									side='right'
								>
									<PouCard>
										<PouCardLabel type={label} />
										<PouCardForm type={label} />
									</PouCard>
								</PopoverContent>
							</Popover>
						))}
					</PopoverContent>
				</div>
			</Popover>
			{/* Data display */}
			<ProjectTreeRoot label={Name}>
				<ProjectTreeBranch branchTarget='dataType' />
				<ProjectTreeBranch branchTarget='function'>
					{pous
						?.filter(({ type }) => type === 'function')
						.map(({ data }) => (
							<ProjectTreeLeaf
								key={data.name}
								leafLang={data.language}
								label={data.name}
								/** Todo: Update the tab state */
								// onClick={() => handleCreateTab(data)}
							/>
						))}
				</ProjectTreeBranch>
				<ProjectTreeBranch branchTarget='functionBlock'>
					{pous
						?.filter(({ type }) => type === 'function-block')
						.map(({ data }) => (
							<ProjectTreeLeaf
								key={data.name}
								leafLang={data.language}
								label={data.name}
								/** Todo: Update the tab state */
								// onClick={() => handleCreateTab(data)}
							/>
						))}
				</ProjectTreeBranch>
				<ProjectTreeBranch branchTarget='program'>
					{pous
						?.filter(({ type }) => type === 'program')
						.map(({ data }) => (
							<ProjectTreeLeaf
								key={data.name}
								leafLang={data.language}
								label={data.name}
								/** Todo: Update the tab state */
								// onClick={() => handleCreateTab(data)}
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
export { Project }
