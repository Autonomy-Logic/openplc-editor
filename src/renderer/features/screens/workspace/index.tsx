import { useLocation } from 'react-router-dom'
import { useOpenPLCStore } from '~/renderer/store'
import { SidebarComponent } from './components'

// Todo: Add children and the property to exclude the data from the current workspace
export default function Workspace() {
	return (
		<div className='flex h-full items-center w-full p-2'>
			<SidebarComponent.Wrapper>
				{' '}
				<p>Sidebar Wrapper</p>
			</SidebarComponent.Wrapper>
		</div>
	)
}
