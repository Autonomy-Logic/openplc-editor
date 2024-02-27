import { useLocation } from 'react-router-dom'
import { OpenPLCIcon } from '~/renderer/assets/icons/oplc'

export const TitlebarCenterContent = () => {
	const navigation = useLocation()
	const path = navigation.pathname

	/**
	 * TODO: Add the titlebar center content here based on the OS
	 */
	return (
		<div className='oplc-titlebar-drag-region flex flex-1 items-center justify-center gap-2'>
			{!path.includes('/workspace') && (
				<span className='text-xs font-normal font-caption'>OpenPLC Editor</span>
			)}
		</div>
	)
}
