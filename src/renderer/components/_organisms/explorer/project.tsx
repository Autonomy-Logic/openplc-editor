import {
	CExtIcon,
	DataTypeIcon,
	FolderIcon,
	FunctionBlockIcon,
	FunctionIcon,
	PlusIcon,
	ProgramIcon,
	ResourceIcon,
} from '@root/renderer/assets'
import {
	ProjectTreeRoot,
	ProjectTreeBranch,
	ProjectTreeLeaf,
} from '@components/_molecules/project-tree'
import { useOpenPLCStore } from '@root/renderer/store'
import { IPouTemplate } from '@root/types/transfer'
import * as Popover from '@radix-ui/react-popover'

const ProjectExplorer = () => {
	const {
		data,
		updateEditor,
		updateTabs,
		tabsState: { tabs },
	} = useOpenPLCStore()
	const Name = 'Project Name'

	const handleCreateTab = (tab: IPouTemplate) => {
		const { name, type, languageCodification, language } = tab
		updateTabs([
			...tabs,
			{
				name,
				type,
				languageCodification,
				language,
			},
		])
		updateEditor({ path: name, value: tab.body })
	}

	const projectOptions = {
		Function: {
			name: 'Function',
			type: 'Function',
			icon: <FunctionIcon size='md' />,
		},
		Function_Block: {
			name: 'Function Block',
			type: 'Function Block',
			icon: <FunctionBlockIcon size='md' />,
		},
		Program: {
			name: 'Program',
			type: 'Program',
			icon: <ProgramIcon size='md' />,
		},
		Data_Type: {
			name: 'Data Type',
			type: 'Data Type',
			icon: <DataTypeIcon size='md' />,
		},
	}
	return (
		<>
			{/* Actions handler */}
			<Popover.Root>
				<div className='flex justify-around w-[200px] my-3 px-2'>
					<div className='flex items-center justify-start px-1.5 w-32 h-8 gap-1 rounded-lg cursor-default select-none bg-neutral-100 dark:bg-brand-dark'>
						<FolderIcon size='sm' />
						<span className='pl-1 font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-50'>
							{Name}
						</span>
					</div>
					<Popover.Trigger
						type='button'
						className='w-10 h-8 rounded-lg bg-brand flex justify-center items-center'
					>
						<PlusIcon className='stroke-white' />
					</Popover.Trigger>
					<Popover.Content alignOffset={-7} sideOffset={10}>
						<div className='w-[188px] h-fit border border-brand-light dark:border-brand-medium-dark bg-white dark:bg-neutral-950 p-2 rounded-xl flex flex-col gap-2'>
							{Object.entries(projectOptions).map(([key, value]) => (
								<Popover.Root>
									<div className='h-full w-full'>
										<Popover.Trigger
											className='flex items-center justify-start w-full h-7 gap-1 rounded-lg cursor-default select-none hover:bg-neutral-100 p-2 dark:hover:bg-neutral-900'
											key={key}
										>
											{value.icon}
											<span className='pl-1  text-xs font-medium text-neutral-950 dark:text-neutral-50'>
												{value.name}
											</span>
										</Popover.Trigger>
										<Popover.Content
											alignOffset={-7}
											align='start'
											side='right'
											className=' ml-4 flex flex-col gap-3  w-[188px] h-fit border border-brand-light dark:border-brand-medium-dark bg-white dark:bg-neutral-950 p-2 rounded-xl'
										>
											<div className='flex items-center w-full'>
												{value.icon}
												<span className='pl-1 text-xs font-medium text-neutral-950 dark:text-neutral-50'>
													{value.name}
												</span>
											</div>
											<div className='w-full flex flex-col gap-[6px] '>
												<span className='text-xs font-medium text-neutral-1000 dark:text-neutral-50'>
													POU name:
												</span>
												<input
													type='text'
													placeholder='POU name'
													className='px-2 w-full outline-none border border-neutral-100 dark:border-brand-medium-dark text-neutral-850 font-medium text-xs bg-white dark:bg-neutral-950 h-[26px] rounded-lg'
												/>
											</div>
											<div className='w-full flex flex-col gap-[6px] '>
												<p className='text-xs font-medium text-neutral-1000 dark:text-neutral-50'>
													Language:
												</p>
												<select
													aria-label='Select Language'
													id=''
													className='px-2 w-full outline-none border border-neutral-100 dark:border-brand-medium-dark text-neutral-850 font-medium text-xs bg-white dark:bg-neutral-950 h-[26px] rounded-lg'
												>
													<option value='LD'>Ladde Diagram</option>
													<option value='SF'>Sequential Function Chart</option>
													<option value='FD'>Functional Block Diagram</option>
													<option value='ST'>Structured Text</option>
													<option value='IL'>Instruction List</option>
												</select>
											</div>
											<div className='w-full flex justify-between'>
												<button
													type='button'
													className='w-20 h-6 bg-brand rounded-lg text-white font-medium text-xs'
												>
													Create
												</button>
												<button
													type='button'
													className='w-20 h-6 bg-neutral-100 rounded-lg text-neutral-1000  font-medium text-xs'
												>
													Cancel
												</button>
											</div>
										</Popover.Content>
									</div>
								</Popover.Root>
							))}
						</div>
					</Popover.Content>
				</div>
			</Popover.Root>
			{/* Data display */}
			{/* Work in progress: Do not change the structure */}
			<ProjectTreeRoot label={Name}>
				<ProjectTreeLeaf leafLang='DT' />
				<ProjectTreeBranch branchTarget='function'>
					{data.pous
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
					{data.pous
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
					{data.pous
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
				<ProjectTreeLeaf leafLang='RES' label='Resources' />
			</ProjectTreeRoot>
		</>
	)
}
export { ProjectExplorer }
