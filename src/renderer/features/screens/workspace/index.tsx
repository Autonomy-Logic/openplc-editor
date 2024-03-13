import Activitybar from './components/activitybar'
import { MainContent } from './components/main-content'

export default function Workspace() {
	return (
		<div className='flex w-full h-full bg-brand-dark dark:bg-neutral-950'>
			{/** Here goes the activity component */}
			<Activitybar />
			<MainContent />
		</div>
	)
}
