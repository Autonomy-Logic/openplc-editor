import { ReactNode, useState } from 'react'
import { Panel } from 'react-resizable-panels'
import { ProjectTree } from './project-tree'
import { LibraryTree } from './library-tree'

export const SidebarPanel = (): ReactNode => {
	const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
	return (
		<Panel
			onCollapse={() => setIsSidebarCollapsed(true)}
			onExpand={() => setIsSidebarCollapsed(false)}
			collapsible={true}
			collapsedSize={0}
			id='sidebar'
			minSize={15}
			defaultSize={17}
			className={` h-full border-inherit rounded-lg overflow-auto border-2 border-neutral-200 bg-white dark:bg-neutral-950 ${
				isSidebarCollapsed ? 'border-none' : ''
			}`}
		>
			<ProjectTree />
			<hr className='h-[1px] bg-neutral-600 w-full' />
			<LibraryTree />
			<div className='w-full h-[17%] p-3'>
				<p className='w-full h-full bg-white font-caption text-xs text-start p-2 overflow-y-auto text-neutral-850 font-normal rounded-lg border border-brand shadow-2xl'>
					Reads temperature from one DS18B20 one-wire sensor connected to the
					pin specified in PIN (SINT:PIN) =&gt; (REAL:OUT)
				</p>
			</div>
		</Panel>
	)
}
