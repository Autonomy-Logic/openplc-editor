import { ComponentProps, ReactNode } from 'react'
import { Tree, Header } from './components'
import {
	DataTypeIcon,
	DeviceIcon,
	FBDIcon,
	FolderIcon,
	FunctionBlockIcon,
	FunctionIcon,
	ILIcon,
	LDIcon,
	PLCIcon,
	PlusIcon,
	ProgramIcon,
	ResourceIcon,
	SFCIcon,
	STIcon,
} from '~renderer/assets'

type IProjectTreeProps = ComponentProps<'div'>
export const ProjectTree = (props: IProjectTreeProps): ReactNode => {
	const treeData = [
		{
			key: '0',
			label: 'Project Name',
			Icon: PLCIcon,
			title: 'Project Name Leaf',
			children: [
				{
					key: '0.0',
					label: 'Data Types',
					Icon: DataTypeIcon,
					title: 'Data Types Tree Leaf',
					children: [],
				},
				{
					key: '0.1',
					label: 'Functions',
					Icon: FunctionIcon,
					title: 'Functions Tree Leaf',
					children: [
						{
							key: '0.1.0',
							label: 'IL Function',
							Icon: ILIcon,
							title: 'IL Function Leaf',
							children: [],
						},
						{
							key: '0.1.1',
							label: 'ST Function',
							Icon: STIcon,
							title: 'ST Function Leaf',
							children: [],
						},
					],
				},
				{
					key: '0.2',
					label: 'Functions Blocks',
					Icon: FunctionBlockIcon,
					title: 'Functions Blocks Tree Leaf',
					children: [],
				},
				{
					key: '0.3',
					label: 'Programs',
					Icon: ProgramIcon,
					title: 'Programs Tree Leaf',
					children: [
						{
							key: '0.3.0',
							label: 'LD Program',
							Icon: LDIcon,
							title: 'LD Program Leaf',
							children: [],
						},
						{
							key: '0.3.1',
							label: 'SFC Program',
							Icon: SFCIcon,
							title: 'SFC Program Leaf',
							children: [],
						},
						{
							key: '0.3.2',
							label: 'FBD Program',
							Icon: FBDIcon,
							title: 'FBD Program Leaf',
							children: [],
						},
					],
				},
				{
					key: '0.4',
					label: 'Resource',
					Icon: ResourceIcon,
					title: 'Resource Tree Leaf',
					children: [],
				},
				{
					key: '0.5',
					label: 'Device',
					Icon: DeviceIcon,
					title: 'Device Tree Leaf',
					children: [],
				},
			],
		},
	]
	return (
		<div className='w-full h-2/5 border-none bg-none flex flex-col' {...props}>
			<Header
				title='Project Name'
				TitleIcon={FolderIcon}
				ButtonIcon={PlusIcon}
			/>
			<div className='overflow-y-auto overflow-x-hidden'>
				<Tree treeData={treeData} />
			</div>
		</div>
	)
}
