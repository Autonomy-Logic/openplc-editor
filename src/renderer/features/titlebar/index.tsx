import { TitlebarLeftContent } from './titlebar-left-content'
import { TitlebarCenterContent } from './titlebar-center-content'
import { TitlebarRightContent } from './titlebar-right-content'

export const TitleBar = () => {
	return (
		<div className='oplc-titlebar-container'>
			<div className='oplc-titlebar-content dark:bg-neutral-950'>
				<TitlebarLeftContent />
				<TitlebarCenterContent />
				<TitlebarRightContent />
			</div>
		</div>
	)
}
