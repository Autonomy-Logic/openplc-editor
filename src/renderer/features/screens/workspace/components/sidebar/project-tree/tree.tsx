import { ComponentProps, ElementType, ReactNode, useState } from 'react'
import { ArrowIcon } from '../../../assets'
import { cn } from '~/utils'

type ILeafData = {
	key: string
	label: string
	Icon: ElementType
	title: string
	children?: ILeafData[]
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
	const { Icon, children, key, label, title } = leafData
	const hasChildren = children ? true : false
	return (
		/** The leaf component */
		<li className='p-1' key={key}>
			{/** The button component to render the arrow to open the tree */}
			<button
				className='flex items-center'
				type='button'
				onClick={(e) => setChildVisible((v) => !v)}
			>
				{hasChildren && (
					<ArrowIcon
						className={cn(
							`stroke-brand-light w-4 h-4 transition-all ${
								childVisible && 'stroke-brand rotate-90'
							}`
						)}
					/>
				)}
				<div>
					<i>{/** Icon for the file/folder being rendered */}</i>
					<Icon />
					{/** Label for the file/folder being rendered */}
					<span
						className={cn(
							`font-caption text-xs font-normal text-neutral-850 ${
								childVisible && 'font-medium text-neutral-1000'
							}`
						)}
					>
						{label}
					</span>
				</div>
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
