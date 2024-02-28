import { useOpenPLCStore } from '~/renderer/store'
import { MinimizeIcon, MaximizeIcon, CloseIcon } from './window-controls-icons'

export const TitlebarRightContent = () => {
	/**
	 * Get the platform name from the store and check if it's macOS
	 */
	const platformName = useOpenPLCStore().platformName
	const isMac = platformName === 'darwin'
	/**
	 * Create a template for macOS systems
	 */
	const DarwinTemplate = () => <></>
	/**
	 * Create a template for windows and other systems
	 */
	const DefaultTemplate = () => {
		return (
			<div className='flex h-full'>
				<button
					type='button'
					className='px-[10px] h-full flex justify-center items-center hover:bg-[#021633] hover:dark:bg-neutral-850'
					onClick={() => window.bridge.minimizeWindow()}
				>
					<MinimizeIcon />
				</button>
				<button
					type='button'
					className='px-[10px] h-full flex justify-center items-center hover:bg-[#021633] hover:dark:bg-neutral-850'
					onClick={() => window.bridge.maximizeWindow()}
				>
					<MaximizeIcon />
				</button>
				<button
					type='button'
					className='px-[10px] h-full flex justify-center items-center hover:bg-red-600'
					onClick={() => window.bridge.closeWindow()}
				>
					<CloseIcon />
				</button>
			</div>
		)
	}
	/**
	 * Render the appropriate template based on the platform
	 */
	return (
		<div className='flex items-center justify-end'>
			{isMac ? <DarwinTemplate /> : <DefaultTemplate />}
		</div>
	)
}
