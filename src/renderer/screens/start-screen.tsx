import { FolderIcon, PlusIcon, StickArrowIcon, VideoIcon } from '../assets'
import {
	MenuRoot,
	MenuItem,
	MenuDivider,
	MenuSection,
} from '../components/_features/[start]/menu'
import { StartMainContent, StartSideContent } from '../components/_templates'

const StartScreen = () => {
	return (
		<>
			<StartSideContent>
				<MenuRoot>
					<MenuSection id='1'>
						<MenuItem onClick={() => console.log('create project')}>
							<PlusIcon className='stroke-white' /> New Project
						</MenuItem>
						<MenuItem ghosted onClick={() => console.log('open project')}>
							<FolderIcon /> Open
						</MenuItem>
						<MenuItem ghosted>
							<VideoIcon /> Tutorials{' '}
						</MenuItem>
					</MenuSection>
					<MenuDivider />
					<MenuSection id='2'>
						<MenuItem onClick={() => console.log('create project')} ghosted>
							<StickArrowIcon className='rotate-180' /> Quit
						</MenuItem>
					</MenuSection>
				</MenuRoot>
			</StartSideContent>
			<StartMainContent>
				<div className='text-2xl text-neutral-1000 dark:text-white'>
					Welcome to OpenPLC Editor
				</div>
			</StartMainContent>
		</>
	)
}
export { StartScreen }
