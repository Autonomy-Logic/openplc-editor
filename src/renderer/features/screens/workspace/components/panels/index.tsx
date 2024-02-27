import { ReactNode } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { SidebarPanel } from './sidebar-panel'
import { NavigationPanel } from './navigation-panel'
import { EditorPanel } from './editor-panel'
import { BottomPanel } from './bottom-panel'

export const PanelsGroupComponent = (): ReactNode => {
	return (
		<PanelGroup
			direction='horizontal'
			className='bg-brand-dark dark:bg-neutral-950'
		>
			<div className='!rounded-tl-lg flex-grow h-full bg-neutral-100 dark:bg-neutral-900 flex p-2 gap-1'>
				<SidebarPanel />
				{/* Here goes the sidebar component */}
				<PanelResizeHandle
				// className={`hover:bg-neutral-400 ${
				// 	isSidebarCollapsed ? 'hidden ' : ''
				// }  `}
				/>
				<Panel>
					<PanelGroup
						className='flex-grow h-full overflow-hidden flex flex-col gap-1'
						direction='vertical'
					>
						{/* Here goes the top panel component */}
						<NavigationPanel />
						<EditorPanel />
						{/* Here goes the editor component */}
						<PanelResizeHandle
						// className={`hover:bg-neutral-400 ${
						// 	isBottomBarCollapsed ? 'hidden ' : ''
						// } `}
						/>

						<BottomPanel />
						{/* Here goes the bottom panel component */}
					</PanelGroup>
				</Panel>
			</div>
		</PanelGroup>
	)
}
