import {
	ArrowIcon,
	DataTypeIcon,
	FunctionIcon,
	FunctionBlockIcon,
	ProgramIcon,
	DeviceIcon,
	PLCIcon,
	ILIcon,
	STIcon,
	FBDIcon,
	SFCIcon,
	LDIcon,
	ResourceIcon,
} from '@root/renderer/assets'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import {
	ComponentPropsWithoutRef,
	ReactNode,
	useCallback,
	useState,
} from 'react'

type IProjectTreeRootProps = ComponentPropsWithoutRef<'ul'> & {
	label: string
	children: ReactNode
}
const ProjectTreeRoot = ({
	children,
	label,
	...res
}: IProjectTreeRootProps) => {
	const [isOpen, setIsOpen] = useState(true)
	const handleVisibility = useCallback(() => setIsOpen(!isOpen), [isOpen])
	return (
		<div className='select-none'>
			<ul className='list-none p-0' {...res}>
				{/* biome-ignore lint/a11y/useKeyWithClickEvents: Do not use */}
				<li
					className=' flex flex-row items-center py-1 pl-2 hover:bg-slate-50 dark:hover:bg-neutral-900 cursor-pointer'
					onClick={handleVisibility}
				>
					<ArrowIcon
						direction='right'
						className={cn(
							`stroke-brand-light w-4 h-4 transition-all mr-[6px] ${
								isOpen && 'stroke-brand rotate-270'
							}`
						)}
					/>
					<PLCIcon />
					<span
						className={cn(
							'font-caption text-xs font-normal text-neutral-850 dark:text-neutral-300 ml-1 truncate',
							isOpen && 'font-medium text-neutral-1000 dark:text-white'
						)}
					>
						{label}
					</span>
				</li>
				{children && isOpen && (
					<div className='pl-2'>
						<ul>
							{children && (
								<div>
									<ul className='list-none p-0'>{children}</ul>
								</div>
							)}
						</ul>
					</div>
				)}
			</ul>
		</div>
	)
}

type IProjectTreeBranchProps = ComponentPropsWithoutRef<'li'> & {
	branchTarget: 'dataType' | 'function' | 'functionBlock' | 'program' | 'device'
	children?: ReactNode
}

const BranchSources = {
	dataType: { BranchIcon: DataTypeIcon, label: 'Data Types' },
	function: { BranchIcon: FunctionIcon, label: 'Functions' },
	functionBlock: { BranchIcon: FunctionBlockIcon, label: 'Function Blocks' },
	program: { BranchIcon: ProgramIcon, label: 'Programs' },
	device: { BranchIcon: DeviceIcon, label: 'Device' },
}
const ProjectTreeBranch = ({
	branchTarget,
	children,
	...res
}: IProjectTreeBranchProps) => {
	const {
		workspaceState: { projectData: { pous } },
	} = useOpenPLCStore()
	const [branchIsOpen, setBranchIsOpen] = useState(false)
	const handleBranchVisibility = useCallback(
		() => setBranchIsOpen(!branchIsOpen),
		[branchIsOpen]
	)

	const { BranchIcon, label } = BranchSources[branchTarget]

	return (
		<li
			aria-expanded={branchIsOpen}
			className='cursor-pointer aria-expanded:cursor-default '
			{...res}
		>
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: <explanation> */}
			<div
				className='cursor-pointer flex flex-row items-center w-full py-1 pl-2 hover:bg-slate-50 dark:hover:bg-neutral-900'
				onClick={handleBranchVisibility}
			>
				{pous?.length !== 0 ? (
					<ArrowIcon
						direction='right'
						className={cn(
							`stroke-brand-light w-4 h-4 transition-all mr-[6px] ${
								branchIsOpen && 'stroke-brand rotate-270'
							}`
						)}
					/>
				) : (
					<div className='w-[22px]' />
				)}
				<BranchIcon />
				<span
					className={cn(
						'font-caption text-xs font-normal text-neutral-850 dark:text-neutral-300 ml-1 truncate',
						branchIsOpen && 'font-medium text-neutral-1000 dark:text-white'
					)}
				>
					{label}
				</span>
			</div>

			{children && branchIsOpen && (
				<div>
					<ul>
						{children && (
							<div>
								<ul className='list-none p-0'>{children}</ul>
							</div>
						)}
					</ul>
				</div>
			)}
		</li>
	)
}

type IProjectTreeLeafProps = ComponentPropsWithoutRef<'li'> & {
	leafLang: 'IL' | 'ST' | 'FBD' | 'SFC' | 'LD' | 'DT' | 'RES'
	label?: string
}

const LeafSources = {
	IL: { LeafIcon: ILIcon },
	ST: { LeafIcon: STIcon },
	FBD: { LeafIcon: FBDIcon },
	SFC: { LeafIcon: SFCIcon },
	LD: { LeafIcon: LDIcon },
	DT: { LeafIcon: DataTypeIcon },
	RES: { LeafIcon: ResourceIcon },
}
const ProjectTreeLeaf = ({
	leafLang,
	label = 'Data Type',
	...res
}: IProjectTreeLeafProps) => {
	const [leafIsSelected, setLeafIsSelected] = useState(false)
	const { LeafIcon } = LeafSources[leafLang]

	const handleLeafSelection = useCallback(
		() => setLeafIsSelected(!leafIsSelected),
		[leafIsSelected]
	)

	return (
		<li
			className='py-1 pl-4 ml-4 flex flex-row items-center hover:bg-slate-50 dark:hover:bg-neutral-900 cursor-pointer'
			onClick={handleLeafSelection}
			{...res}
		>
			<LeafIcon />
			<span
				className={cn(
					'font-caption text-xs font-normal text-neutral-850 dark:text-neutral-300 ml-1 truncate',
					leafIsSelected && 'font-medium text-neutral-1000 dark:text-white'
				)}
			>
				{label}
			</span>
		</li>
	)
}
export { ProjectTreeRoot, ProjectTreeBranch, ProjectTreeLeaf }
