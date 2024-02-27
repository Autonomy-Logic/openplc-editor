import { OpenPLCIcon } from '~/renderer/assets/icons/oplc'
import { MenuBar } from './menu/menu-bar'
import { useLocation } from 'react-router-dom'

export const TitlebarLeftContent = () => {
	const navigation = useLocation()
	const path = navigation.pathname
	return (
		<div className='flex items-center justify-start px-4 py-0.5 gap-1'>
			{path.includes('/workspace') && (
				<>
					<OpenPLCIcon />
					<MenuBar />
				</>
			)}
		</div>
	)
}
