import { useLocation } from 'react-router-dom'
import { OpenPLCIcon } from '@process:renderer/assets/icons/oplc'
import { useOpenPLCStore } from '@process:renderer/store'

export const TitlebarCenterContent = () => {
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
	const DarwinTemplate = () => {
		return (
			<>
				<OpenPLCIcon />
				<span className='text-xs font-normal font-caption'>OpenPLC Editor</span>
			</>
		)
	}
	/**
	 * Create a template for windows and other systems
	 */
	const DefaultTemplate = () =>
		!path.includes('/workspace') ? (
			<span className='text-xs font-normal font-caption'>OpenPLC Editor</span>
		) : (
			<></>
		)
	/**
	 * Render the appropriate template based on the platform
	 */
	return (
		<div className='oplc-titlebar-drag-region flex flex-1 items-center justify-center gap-2'>
			{isMac ? <DarwinTemplate /> : <DefaultTemplate />}
		</div>
	)
}
