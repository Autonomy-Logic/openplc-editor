import { useLocation } from 'react-router-dom'

// Todo: Add children and the property to exclude the data from the current workspace
export default function Editor() {
	const location = useLocation()
	console.log(location.pathname)
	// const projectDataDraft = useOpenPLCStore.useProjectData();
	// const projectPathDraft = useOpenPLCStore.useProjectPath();
	return (
		<div className='flex h-full'>
			<div className='flex h-full'>
				<nav className='flex h-full w-20 flex-col items-center justify-between border-r border-gray-100 bg-white px-4 py-4 dark:border-white/5 dark:bg-gray-900'>
					<h1>Teste</h1>
				</nav>
			</div>
		</div>
	)
}
