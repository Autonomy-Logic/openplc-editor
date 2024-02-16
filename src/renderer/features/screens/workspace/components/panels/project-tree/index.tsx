import { Tree } from './tree'
import {
	FunctionBlockIcon,
	FunctionIcon,
	PLCIcon,
	ProgramIcon,
	ResourceIcon,
	DeviceIcon,
	DataTypeIcon,
	ILIcon,
	STIcon,
	LDIcon,
	SFCIcon,
	FBDIcon,
} from '../../../assets/icons'
import { Wrapper } from './wrapper'
import { Header } from './header'

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
		<Wrapper>
			<Header />
			<Tree treeData={treeData} />
		</Wrapper>
	)
}
