import {
	ArrowIcon,
	DataTypeIcon,
	FunctionIcon,
	FunctionBlockIcon,
	ProgramIcon,
	PLCIcon,
	ILIcon,
	STIcon,
	FBDIcon,
	SFCIcon,
	LDIcon,
} from '@root/renderer/assets'
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
	const [isOpen, setIsOpen] = useState(false)
	const handleVisibility = useCallback(() => setIsOpen(!isOpen), [isOpen])
	return (
		<div>
			<ul className='list-none p-0' {...res}>
				<button
					type='button'
					className='flex flex-row items-center'
					onClick={handleVisibility}
				>
					<ArrowIcon
						direction='right'
						className={cn(
							`stroke-brand-light w-4 h-4 transition-all ${
								isOpen && 'stroke-brand rotate-270'
							}`
						)}
					/>
					<PLCIcon className='w-4 h-4' />
					<span
						className={cn(
							'font-caption text-xs font-normal text-neutral-850 dark:text-neutral-300 ml-1 truncate',
							isOpen && 'font-medium text-neutral-1000 dark:text-white'
						)}
					>
						{label}
					</span>
				</button>
				{children && isOpen && (
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
			</ul>
		</div>
	)
}

type IProjectTreeBranchProps = ComponentPropsWithoutRef<'li'> & {
	branchTarget: 'dataType' | 'function' | 'functionBlock' | 'program'
	children?: ReactNode
}

const BranchSources = {
	dataType: { BranchIcon: DataTypeIcon, label: 'Data Types' },
	function: { BranchIcon: FunctionIcon, label: 'Functions' },
	functionBlock: { BranchIcon: FunctionBlockIcon, label: 'Function Blocks' },
	program: { BranchIcon: ProgramIcon, label: 'Programs' },
}
const ProjectTreeBranch = ({
	branchTarget,
	children,
	...res
}: IProjectTreeBranchProps) => {
	const [branchIsOpen, setBranchIsOpen] = useState(false)
	const handleBranchVisibility = useCallback(
		() => setBranchIsOpen(!branchIsOpen),
		[branchIsOpen]
	)

	const { BranchIcon, label } = BranchSources[branchTarget]

	return (
		<li className='py-1 pl-2' {...res}>
			<button
				type='button'
				className='flex flex-row items-center'
				onClick={handleBranchVisibility}
			>
				<ArrowIcon
					direction='right'
					className={cn(
						`stroke-brand-light w-4 h-4 transition-all ${
							branchIsOpen && 'stroke-brand rotate-270'
						}`
					)}
				/>
				<BranchIcon className='w-4 h-4' />
				<span
					className={cn(
						'font-caption text-xs font-normal text-neutral-850 dark:text-neutral-300 ml-1 truncate',
						branchIsOpen && 'font-medium text-neutral-1000 dark:text-white'
					)}
				>
					{label}
				</span>
			</button>
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
	leafLang: 'IL' | 'ST' | 'FBD' | 'SFC' | 'LD' | 'DT'
	label?: string
}

const LeafSources = {
	IL: { LeafIcon: ILIcon },
	ST: { LeafIcon: STIcon },
	FBD: { LeafIcon: FBDIcon },
	SFC: { LeafIcon: SFCIcon },
	LD: { LeafIcon: LDIcon },
	DT: { LeafIcon: DataTypeIcon },
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
		<li className='py-1 pl-2 ml-2' {...res}>
			<button
				type='button'
				className='flex flex-row items-center'
				onClick={handleLeafSelection}
			>
				<LeafIcon className='w-4 h-4' />
				<span
					className={cn(
						'font-caption text-xs font-normal text-neutral-850 dark:text-neutral-300 ml-1 truncate',
						leafIsSelected && 'font-medium text-neutral-1000 dark:text-white'
					)}
				>
					{label}
				</span>
			</button>
		</li>
	)
}
export { ProjectTreeRoot, ProjectTreeBranch, ProjectTreeLeaf }
