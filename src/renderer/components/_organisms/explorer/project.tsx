import {
	ArrowIcon,
	CExtIcon,
	DataTypeIcon,
	FBDIcon,
	FolderIcon,
	FunctionBlockIcon,
	FunctionIcon,
	ILIcon,
	LDIcon,
	PlusIcon,
	ProgramIcon,
	ResourceIcon,
	SFCIcon,
	STIcon,
} from '@root/renderer/assets'
import {
	ProjectTreeRoot,
	ProjectTreeBranch,
	ProjectTreeLeaf,
} from '@components/_molecules/project-tree'
import { useOpenPLCStore } from '@root/renderer/store'
import { IPouTemplate } from '@root/types/transfer'
import * as Popover from '@radix-ui/react-popover'
import * as Select from '@radix-ui/react-select'
import { useState } from 'react'

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

	const options = [
		{
			name: 'Ladder Diagram',
			icon: <LDIcon size='sm' />,
		},
		{
			name: 'Sequential Functional Charts',
			icon: <SFCIcon size='sm' />,
		},
		{
			name: 'Functional Block Diagram',
			icon: <FBDIcon size='sm' />,
		},
		{
			name: 'Structured Text',
			icon: <STIcon size='sm' />,
		},
		{
			name: 'Intruction List',
			icon: <ILIcon size='sm' />,
		},
	]

	const [option, setOption] = useState('')
	const [selectedOption, setSelectedOption] = useState('Select a language')
	const getSelectedIcon = () => {
		const currentSelectedOption = options.find(
			(opt) => opt.name === selectedOption
		)
		return currentSelectedOption ? currentSelectedOption.icon : null
	}

	return (
		<>
			{/* Actions handler */}
			<Popover.Root>
				<div className='flex justify-around w-[200px] my-3 px-2 relative z-10'>
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
					<Popover.Content alignOffset={-7} sideOffset={10} align='end'>
						<div className='w-[188px] h-fit drop-shadow-lg border border-brand-light dark:border-brand-medium-dark bg-white dark:bg-neutral-950 p-2 rounded-lg flex flex-col gap-2'>
							{Object.entries(projectOptions).map(([key, value]) => (
								<Popover.Root key={key}>
									<div className='h-full w-full relative z-9'>
										<Popover.Trigger className='w-full' asChild>
											<button
												type='button'
												className='data-[state=open]:bg-neutral-100 justify-between dark:data-[state=open]:bg-neutral-900 relative flex items-center w-full h-7 gap-1 rounded-lg cursor-default select-none hover:bg-neutral-100 p-2 dark:hover:bg-neutral-900'
												onClick={() => setOption(value.name)}
											>
												<div className='flex items-center w-full h-full'>
													{value.icon}
													<span className='pl-1 text-xs font-medium text-neutral-950 dark:text-neutral-50'>
														{value.name}
													</span>
												</div>
												<ArrowIcon className='rotate-180 ' />
											</button>
										</Popover.Trigger>
										<Popover.Content
											sideOffset={14}
											alignOffset={-7}
											align='start'
											side='right'
											className='flex flex-col drop-shadow-lg pb-3 px-3 pt-2 gap-3 w-[225px] h-fit border border-brand-light dark:border-brand-medium-dark bg-white dark:bg-neutral-950 p-2 rounded-lg'
										>
											<div className='flex items-center w-full h-8 flex-col justify-between'>
												<div className='flex w-full items-center'>
													{value.icon}
													<span className='pl-1 text-xs font-medium text-neutral-950 dark:text-neutral-50'>
														{value.name}
													</span>
												</div>
												<hr className='stroke-neutral-200 stroke-[1.5px] w-full' />
											</div>
											<div className='w-full flex flex-col gap-[6px] '>
												<span className='text-cp-sm font-medium text-neutral-1000 dark:text-neutral-50'>
													POU name:
												</span>
												<input
													type='text'
													placeholder='POU name'
													className='px-2 w-full  outline-none border border-neutral-100 dark:border-brand-medium-dark text-neutral-850 font-medium text-cp-sm bg-white dark:bg-neutral-950 py-2 h-[30px] rounded-md'
												/>
											</div>
											<div className='w-full flex flex-col gap-[6px] '>
												<p className='text-cp-sm font-medium text-neutral-1000 dark:text-neutral-50'>
													Language:
												</p>

												<Select.Root
													value={selectedOption}
													onValueChange={setSelectedOption}
												>
													<Select.Trigger className='h-[30px] px-[8px] py-1 flex items-center w-full outline-none border border-neutral-100 dark:border-brand-medium-dark text-neutral-850 font-medium text-cp-sm bg-white dark:bg-neutral-950 rounded-md'>
														<div className='w-full justify-between flex items-center'>
															<div className='w-full gap-1 flex items-center'>
																{getSelectedIcon()}
																<p className='font-caption text-cp-sm text-neutral-850 dark:text-neutral-300 font-medium'>
																	{selectedOption}
																</p>
															</div>
															<Select.Icon>
																<ArrowIcon
																	size='sm'
																	className='stroke-brand rotate-270 '
																/>
															</Select.Icon>
														</div>
													</Select.Trigger>
													<Select.Content
														sideOffset={10}
														alignOffset={10}
														position='popper'
														align='center'
														side='bottom'
														className='dark:bg-neutral-950 w-[--radix-select-trigger-width] drop-shadow-lg overflow-hidden border h-fit bg-white border-neutral-100 dark:border-brand-medium-dark rounded-lg'
													>
														<Select.Viewport className='w-full h-full'>
															{options.map((language) => (
																<Select.Item
																	key={language.name}
																	value={language.name}
																	className='px-2 py-[9px] cursor-pointer w-full hover:bg-neutral-100 dark:hover:bg-neutral-900 flex gap-2 items-center text-neutral-850 dark:text-neutral-300 font-medium'
																>
																	{language.icon}

																	<p className='font-caption text-cp-sm text-neutral-850 dark:text-neutral-300 font-medium'>
																		{language.name}
																	</p>
																</Select.Item>
															))}
														</Select.Viewport>
													</Select.Content>
												</Select.Root>
											</div>

											<div className='w-full flex justify-between'>
												<button
													type='button'
													className='font-caption font w-[78px] h-6 bg-brand rounded-md text-white font-medium text-cp-sm'
												>
													Create
												</button>
												<button
													type='button'
													className='font-caption w-[78px] h-6 bg-neutral-100 rounded-md text-neutral-1000 font-medium text-cp-sm'
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
