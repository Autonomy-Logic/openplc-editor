// import {
//   DataTypeIcon,
//   DeviceIcon,
//   FBDIcon,
//   FunctionBlockIcon,
//   FunctionIcon,
//   ILIcon,
//   LDIcon,
//   PLCIcon,
//   ProgramIcon,
//   ResourceIcon,
//   SFCIcon,
//   STIcon,
// } from '@process:renderer/assets'
import { Project } from '@root/renderer/components/_organisms/explorer/project'
import { ComponentProps, ReactNode } from 'react'

type IProjectTreeProps = ComponentProps<'div'>
export const ProjectTree = (props: IProjectTreeProps): ReactNode => {
  // const treeData = [
  //   {
  //     key: '0',
  //     label: 'Project Name',
  //     Icon: PLCIcon,
  //     title: 'Project Name Leaf',
  //     children: [
  //       {
  //         key: '0.0',
  //         label: 'Data Types',
  //         Icon: DataTypeIcon,
  //         title: 'Data Types Tree Leaf',
  //         children: [],
  //       },
  //       {
  //         key: '0.1',
  //         label: 'Functions',
  //         Icon: FunctionIcon,
  //         title: 'Functions Tree Leaf',
  //         children: [
  //           {
  //             key: '0.1.0',
  //             label: 'IL Function',
  //             Icon: ILIcon,
  //             title: 'IL Function Leaf',
  //             children: [],
  //           },
  //           {
  //             key: '0.1.1',
  //             label: 'ST Function',
  //             Icon: STIcon,
  //             title: 'ST Function Leaf',
  //             children: [],
  //           },
  //         ],
  //       },
  //       {
  //         key: '0.2',
  //         label: 'Functions Blocks',
  //         Icon: FunctionBlockIcon,
  //         title: 'Functions Blocks Tree Leaf',
  //         children: [],
  //       },
  //       {
  //         key: '0.3',
  //         label: 'Programs',
  //         Icon: ProgramIcon,
  //         title: 'Programs Tree Leaf',
  //         children: [
  //           {
  //             key: '0.3.0',
  //             label: 'LD Program',
  //             Icon: LDIcon,
  //             title: 'LD Program Leaf',
  //             children: [],
  //           },
  //           {
  //             key: '0.3.1',
  //             label: 'SFC Program',
  //             Icon: SFCIcon,
  //             title: 'SFC Program Leaf',
  //             children: [],
  //           },
  //           {
  //             key: '0.3.2',
  //             label: 'FBD Program',
  //             Icon: FBDIcon,
  //             title: 'FBD Program Leaf',
  //             children: [],
  //           },
  //         ],
  //       },
  //       {
  //         key: '0.4',
  //         label: 'Resource',
  //         Icon: ResourceIcon,
  //         title: 'Resource Tree Leaf',
  //         children: [],
  //       },
  //       {
  //         key: '0.5',
  //         label: 'Device',
  //         Icon: DeviceIcon,
  //         title: 'Device Tree Leaf',
  //         children: [],
  //       },
  //     ],
  //   },
  // ]
  return (
    <div
      className='[&::-webkit-scrollbar]:transition-duration-700 flex h-full w-full flex-col overflow-x-auto border-none bg-none
			pr-1
			[&::-webkit-scrollbar-thumb]:bg-brand
			[&::-webkit-scrollbar-thumb]:dark:bg-neutral-700
			[&::-webkit-scrollbar]:mx-1
			[&::-webkit-scrollbar]:h-0
			[&::-webkit-scrollbar]:bg-neutral-200
			[&::-webkit-scrollbar]:transition-all
			[&::-webkit-scrollbar]:hover:h-[6px]
			[&::-webkit-scrollbar]:dark:bg-neutral-850'
      {...props}
    >
      {/* <Header
				title='Project Name'
				TitleIcon={FolderIcon}
				ButtonIcon={PlusIcon}
			/> */}
      <div
        className='mb-3 overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar-thumb]:bg-brand
			[&::-webkit-scrollbar-thumb]:dark:bg-neutral-700
			[&::-webkit-scrollbar]:w-1
			[&::-webkit-scrollbar]:bg-neutral-200
			[&::-webkit-scrollbar]:dark:bg-neutral-850'
        // [&::-webkit-scrollbar-thumb]:w-[6px]'
      >
        <Project />
      </div>
    </div>
  )
}
