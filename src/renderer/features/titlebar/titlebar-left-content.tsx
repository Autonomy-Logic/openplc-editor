import { OpenPLCIcon } from '~/renderer/assets/icons/oplc'
import { MenuBar } from './menu/menu-bar'

export const TitlebarLeftContent = () => {
	return (
		<div className='flex items-center justify-start px-4 py-0.5 gap-1'>
			<OpenPLCIcon />
			<MenuBar />
		</div>
	)
}
