import { ComponentProps, ElementType, ReactNode, useState } from 'react'
import { ArrowIcon } from '@process:renderer/assets'
import { cn } from '@utils/cn'

type ILeafData = {
	key: string
	label: string
	Icon: ElementType
	title: string
	children: ILeafData[]
}

type ILeafProps = ComponentProps<'li'> & {
	leafData: ILeafData
}

type ITreeProps = ComponentProps<'ul'> & {
	treeData: ILeafData[]
}

export const Tree = (props: ITreeProps): ReactNode => {
	const { treeData, ...res } = props
	return (
		<div>
			<ul className='list-none p-0' {...res}>
				{treeData?.map((leaf) => (
					<Leaf key={leaf.key} leafData={leaf} />
				))}
			</ul>
		</div>
	)
}

const Leaf = (props: ILeafProps) => {
	const [childVisible, setChildVisible] = useState(false)
	const { leafData } = props
	const { Icon, children, key, label } = leafData
	const hasChildren = children.length > 0 ? true : false
	return (
		/** The leaf component */
		<li className='py-1 pl-2' key={key}>
			{/** The button component to render the arrow to open the tree */}
			<button
				className='flex flex-row items-center'
				type='button'
				onClick={(e) => setChildVisible((v) => !v)}
			>
				{hasChildren && (
					<ArrowIcon
						direction='right'
						className={cn(
							`stroke-brand-light w-4 h-4 transition-all ${
								childVisible && 'stroke-brand rotate-270'
							}`
						)}
					/>
				)}
				{/** Icon for the file/folder being rendered */}
				<Icon className={`${!hasChildren && 'ml-4'}`} />
				{/** Label for the file/folder being rendered */}
				<span
					className={cn(
						`font-caption text-xs font-normal text-neutral-850 dark:text-neutral-300 ml-1 truncate ${
							childVisible && 'font-medium text-neutral-1000 dark:text-white'
						}`
					)}
				>
					{label}
				</span>
			</button>
			{/** The children of the leaf */}
			{hasChildren && childVisible && (
				<div>
					<ul>{children && <Tree treeData={children} />}</ul>
				</div>
			)}
		</li>
	)
}
