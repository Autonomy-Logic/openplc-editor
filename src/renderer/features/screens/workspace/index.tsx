import { ContainerComponent, PanelsGroupComponent } from './components'
import Activitybar from './components/activitybar'

export default function Workspace() {
	return (
		<>
    <div className='w-full bg-zinc-800 h-9 relative' />
			<ContainerComponent>
				<Activitybar />
				{/** Here goes the activity component */}
				<PanelsGroupComponent />
			</ContainerComponent>
		</>
	)
}
