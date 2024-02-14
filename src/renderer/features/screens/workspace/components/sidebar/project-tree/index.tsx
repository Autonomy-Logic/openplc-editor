import { Tree } from './tree'
import {
	FunctionBlockIcon,
	FunctionIcon,
	PLCIcon,
	ProgramIcon,
	ResourceIcon,
	DeviceIcon,
	FallBackIcon,
} from '../../../assets/icons'

export const ProjectTree = () => {
	const treeData = [
		{
			key: '0',
			label: 'Project Name',
			Icon: PLCIcon,
			title: 'Project Name Leaf',
			children: [
				{
					key: '0.0',
					label: 'Functions',
					Icon: FunctionIcon,
					title: 'Documents Folder',
					children: [
						{
							key: '0-0',
							label: 'Document 1-1',
							Icon: FallBackIcon,
							title: 'Documents Folder',
							children: [
								{
									key: '0-1-1',
									label: 'Document-0-1.doc',
									Icon: FallBackIcon,
									title: 'Documents Folder',
								},
								{
									key: '0-1-2',
									label: 'Document-0-2.doc',
									Icon: FallBackIcon,
									title: 'Documents Folder',
								},
								{
									key: '0-1-3',
									label: 'Document-0-3.doc',
									Icon: FallBackIcon,
									title: 'Documents Folder',
								},
								{
									key: '0-1-4',
									label: 'Document-0-4.doc',
									Icon: FallBackIcon,
									title: 'Documents Folder',
								},
							],
						},
					],
				},
				{
					key: '0.1',
					label: 'Functions Blocks',
					Icon: FunctionBlockIcon,
					title: 'Desktop Folder',
					children: [
						{
							key: '1-0',
							label: 'document1.doc',
							Icon: FallBackIcon,
							title: 'Documents Folder',
						},
						{
							key: '0-0',
							label: 'documennt-2.doc',
							Icon: FallBackIcon,
							title: 'Documents Folder',
						},
					],
				},
				{
					key: '0.2',
					label: 'Programs',
					Icon: ProgramIcon,
					title: 'Downloads Folder',
					children: [],
				},
				{
					key: '0.3',
					label: 'Resources',
					Icon: ResourceIcon,
					title: 'Downloads Folder',
					children: [],
				},
				{
					key: '0.4',
					label: 'Device',
					Icon: DeviceIcon,
					title: 'Downloads Folder',
					children: [],
				},
			],
		},
	]
	return (
		<div className='w-full h-1/2 bg-neutral-50 dark:bg-neutral-950 border-none'>
			<Tree treeData={treeData} />
		</div>
	)
}
