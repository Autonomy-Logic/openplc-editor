import {
	WorkspaceMainContent,
	WorkspaceSideContent,
} from '../components/_templates'

const WorkspaceScreen = () => {
	return (
		<div className='flex w-full h-full bg-brand-dark dark:bg-neutral-950'>
			<WorkspaceSideContent />
			<WorkspaceMainContent />
		</div>
	)
}

export { WorkspaceScreen }
