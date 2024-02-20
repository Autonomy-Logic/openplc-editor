import { ReactNode, useState } from 'react'
import { Panel } from 'react-resizable-panels'
import { ProjectTree } from './project-tree'

export const SidebarPanel = (): ReactNode => {
	const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
	return (
		<Panel
			onCollapse={() => setIsSidebarCollapsed(true)}
			onExpand={() => setIsSidebarCollapsed(false)}
			collapsible={true}
			collapsedSize={0}
			id='sidebar'
			minSize={11}
			defaultSize={11}
			className={` h-full border-inherit rounded-lg overflow-auto border-2 border-neutral-200 bg-white dark:bg-neutral-950 ${
				isSidebarCollapsed ? 'border-none' : ''
			}`}
		>
			<ProjectTree />
			<hr className='h-[1px] bg-neutral-600 w-full' />
			<div className='h-[55%]  dark:bg-neutral-950 border-neutral-200 bg-white'>
				{/** Here goes the library component */}
			</div>
		</Panel>
	)
}
