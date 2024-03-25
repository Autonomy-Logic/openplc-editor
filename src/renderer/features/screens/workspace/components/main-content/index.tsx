import TextEditor from '@features/editors/textual'
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from '../../../../resizable'
import { NavigationPanel } from '../panels/navigation-panel'
import { InfoPanel } from '../panels/sidebar-panel/info-panel'
import { LibraryTree } from '../panels/sidebar-panel/library-tree'
import { ProjectTree } from '../panels/sidebar-panel/project-tree'
import { Variables } from '@root/renderer/features/variables'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'

export const MainContent = () => {
	const platform = useOpenPLCStore().OS
	return (
		/* Refactor: This outside div will be replaced by the new <WorkspaceMainContent /> */
		<div
			className={cn(
				'flex flex-1 flex-grow h-full w-full p-2 gap-1 bg-neutral-100 dark:bg-neutral-900',
				`${platform !== 'linux' && '!rounded-tl-lg'}`
			)}
		>
			<ResizablePanelGroup
				id='mainContentPanelGroup'
				direction='horizontal'
				className='w-full h-full'
			>
				<ResizablePanel
					id='sidebarPanel'
					order={1}
					collapsible={true}
					minSize={11}
					defaultSize={13}
					className='flex flex-col h-full w-[200px] border-inherit rounded-lg overflow-auto border-2 data-[panel-size="0.0"]:hidden border-neutral-200 dark:border-neutral-850 bg-white dark:bg-neutral-950'
				>
					<ResizablePanelGroup
						id='sidebarContentPanelGroup'
						direction='vertical'
						className='flex-1 h-full'
					>
						<ResizablePanel
							id='sidebarProjectTreePanel'
							order={1}
							defaultSize={50}
						>
							<ProjectTree />
						</ResizablePanel>
						<ResizableHandle className='bg-neutral-200 dark:bg-neutral-850' />
						<ResizablePanel
							id='sidebarLibraryTreePanel'
							order={2}
							defaultSize={50}
						>
							<LibraryTree />
						</ResizablePanel>
					</ResizablePanelGroup>
					<InfoPanel />
				</ResizablePanel>
				<ResizableHandle className='mr-2' />
				<ResizablePanel
					id='workspacePanel'
					order={2}
					defaultSize={87}
					className='h-full w-[400px]'
				>
					<div
						id='workspaceContentPanel'
						className='flex-1 grow h-full overflow-hidden flex flex-col gap-2'
					>
						<NavigationPanel />
						<ResizablePanelGroup id='editorPanelGroup' direction='vertical'>
							<ResizablePanel
								id='editorPanel'
								order={1}
								defaultSize={75}
								className='flex-1 grow rounded-lg overflow-hidden flex flex-col border-2 border-neutral-200 bg-white dark:bg-neutral-950 dark:border-neutral-800 p-4'
							>
								<ResizablePanelGroup
									id='editorContentPanelGroup'
									direction='vertical'
									className='flex flex-1 flex-col gap-2'
								>
									<ResizablePanel
										id='variableTablePanel'
										order={1}
										collapsible
										collapsedSize={0}
										minSize={20}
										defaultSize={25}
										className='flex flex-1 flex-col gap-4 w-full h-full'
									>
										<Variables />
									</ResizablePanel>
									<ResizableHandle className='h-[1px] bg-brand-light w-full' />
									<ResizablePanel
										id='textualEditorPanel'
										order={2}
										defaultSize={75}
										className='flex-1 flex-grow rounded-md mt-6'
									>
										<TextEditor />
									</ResizablePanel>
								</ResizablePanelGroup>
							</ResizablePanel>
							<ResizableHandle className='mt-2' />
							<ResizablePanel
								id='consolePanel'
								order={2}
								collapsible
								defaultSize={25}
								minSize={15}
								className='flex-1 grow border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 rounded-lg border-2 data-[panel-size="0.0"]:hidden'
							>
								<span>Console</span>
							</ResizablePanel>
						</ResizablePanelGroup>
					</div>
				</ResizablePanel>
			</ResizablePanelGroup>
		</div>
	)
}
