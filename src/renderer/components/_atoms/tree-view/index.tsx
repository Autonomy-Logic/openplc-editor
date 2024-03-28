import { ComponentProps } from 'react'
import { TreeItem, ITreeItemProps } from '../tree-item'

type ITreeViewProps = ComponentProps<'ul'> & {
	items: ITreeItemProps[]
}
const TreeView = ({ items, ...res }: ITreeViewProps) => (
	<ul className='list-none p-0' {...res}>
		{items?.map((item) => (
			<TreeItem {...item} />
		))}
	</ul>
)

export { TreeView, type ITreeViewProps }
