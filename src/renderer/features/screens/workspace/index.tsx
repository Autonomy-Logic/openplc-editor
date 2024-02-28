import { PanelsGroupComponent } from './components'
import Activitybar from './components/activitybar'

export default function Workspace() {
	return (
		<>
			<Activitybar />
			{/** Here goes the activity component */}
			<PanelsGroupComponent />
		</>
	)
}
