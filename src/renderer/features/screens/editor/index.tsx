import { useLocation } from 'react-router-dom'
import { useOpenPLCStore } from '~/renderer/store'

// Todo: Add children and the property to exclude the data from the current workspace
export default function Editor() {
	const location = useLocation()
	// console.log(location.pathname);

	const projectDataDraft = useOpenPLCStore.useProjectData()
	const projectPathDraft = useOpenPLCStore.useProjectPath()
	return (
		<div className='flex h-full items-center w-full'>
			<div className='flex h-full items-center w-full flex-col'>
				<p>Path: {projectPathDraft}</p>
				<p className='flex-wrap'>
					Data: {JSON.stringify(projectDataDraft?.project)}
				</p>
			</div>
		</div>
	)
}
