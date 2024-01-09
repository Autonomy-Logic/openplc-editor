import { useLocation } from 'react-router-dom'

// Todo: Add children and the property to exclude the data from the current workspace
export default function Editor() {
	const location = useLocation()
	console.log(location.pathname)
	// const projectDataDraft = useOpenPLCStore.useProjectData();
	// const projectPathDraft = useOpenPLCStore.useProjectPath();
	return (
		<div className='flex h-full items-center'>
			<p className='w-96 h-44 rounded-lg bg-none text-lg font-display font-medium text-center text-neutral-50 mx-auto flex justify-center items-center border border-brand-medium-dark'>
				This is a dummy screen that is mock for development purpose.
			</p>
		</div>
	)
}
