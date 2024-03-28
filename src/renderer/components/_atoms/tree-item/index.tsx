import { ArrowIcon } from '@root/renderer/assets'
import { cn } from '@root/utils'
import { ElementType, memo, useRef } from 'react'
import { TreeView } from '../tree-view'

type ITreeItemProps = {
	key: string
	label: string
	Icon: ElementType
	children: ITreeItemProps[]
}
const TreeItem = memo(({ Icon, children, key, label }: ITreeItemProps) => {
	const hasChildren = children.length > 0
	const isChildVisible = useRef(false)

	const handleChildVisibility = () => {
		isChildVisible.current = !isChildVisible.current
	}

	return (
		<li className='py-1 pl-2' key={key}>
			<button
				type='button'
				className='flex flex-row items-center'
				onClick={() => handleChildVisibility()}
			>
				{hasChildren && (
					<ArrowIcon
						direction='right'
						className={cn(
							`stroke-brand-light w-4 h-4 transition-all ${
								isChildVisible.current && 'stroke-brand rotate-270'
							}`
						)}
					/>
				)}
				{/** Icon for the file/folder being rendered */}
				<Icon className={`${!hasChildren && 'ml-4'}`} />
				{/** Label for the file/folder being rendered */}
				<span
					className={cn(
						'font-caption text-xs font-normal text-neutral-850 dark:text-neutral-300 ml-1 truncate',
						isChildVisible.current &&
							'font-medium text-neutral-1000 dark:text-white'
					)}
				>
					{label}
				</span>
			</button>
			{hasChildren && isChildVisible.current && (
				<ul>{children && <TreeView items={children} />}</ul>
			)}
		</li>
	)
})
export { TreeItem, type ITreeItemProps }
