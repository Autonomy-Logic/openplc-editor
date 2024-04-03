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
		Resource: {
			name: 'Resource',
			type: 'Resource',
			icon: <ResourceIcon size='md' />,
		},
		Data_Type: {
			name: 'Data Type',
			type: 'Data Type',
			icon: <DataTypeIcon size='md' />,
		},
		C_Extension: {
			name: 'C Extension',
			type: 'C Extension',
			icon: <CExtIcon size='md' />,
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
					<Popover.Content align='end' alignOffset={-7} sideOffset={10}>
						<div className='w-[188px] h-fit border border-brand-light bg-white dark:bg-brand-dark p-2 rounded-xl flex flex-col gap-2'>
							{Object.entries(projectOptions).map(([key, value]) => (
								<button
									className='flex items-center justify-start w-full h-7 gap-1 rounded-lg cursor-default select-none hover:bg-neutral-100 p-2 dark:hover:bg-brand-dark'
									key={key}
								>
									{value.icon}
									<span className='pl-1 font-caption text-xs font-medium text-neutral-950 dark:text-neutral-50'>
										{value.name}
									</span>
								</button>
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
