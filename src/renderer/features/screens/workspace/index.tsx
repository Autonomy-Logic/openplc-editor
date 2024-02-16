import WorkspaceContainer from './components/workspace-container'

export default function Workspace() {
	return (
		<div className='containerWrapper bg-[#011E4B] flex h-full items-center w-full'>
			<div className='activitybar h-full w-20 bg-[#011E4B]' />
				<SidebarComponent.ProjectTree />
			<WorkspaceContainer />
		</div>
	)
}
