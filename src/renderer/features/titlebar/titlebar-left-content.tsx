import { OpenPLCIcon } from '~/renderer/assets/icons/oplc'
import { MenuBar } from './menu-bar'
import { useLocation } from 'react-router-dom'
import { useOpenPLCStore } from '~/renderer/store'

export const TitlebarLeftContent = () => {
	/**
	 * Get the platform name from the store and check if it's macOS
	 */
	const OS = useOpenPLCStore().OS
	const isMac = OS === 'darwin'
	/**
	 * Get information about the current location to perform conditional rendering
	 */
	const navigation = useLocation()
	const path = navigation.pathname
	/**
	 * Create a template for macOS systems
	 */
	const DarwinTemplate = () => <></>
	/**
	 * Create a template for windows and other systems
	 */
	const DefaultTemplate = () =>
		path.includes('/workspace') ? (
			<>
				<OpenPLCIcon />
				<MenuBar />
			</>
		) : (
			<></>
		)
	/**
	 * Render the appropriate template based on the platform
	 */
	return (
		<div className='flex items-center justify-start px-4 py-0.5 gap-1'>
			{' '}
			{isMac ? <DarwinTemplate /> : <DefaultTemplate />}
		</div>
	)
}
