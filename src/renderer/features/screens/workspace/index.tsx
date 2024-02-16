import { ContainerComponent, PanelsGroupComponent } from './components'

export default function Workspace() {
	return (
		<ContainerComponent>
			<div className='activitybar h-full w-20 bg-[#011E4B]' />
			{/** Here goes the activity component */}
			<PanelsGroupComponent />
		</ContainerComponent>
	)
}
