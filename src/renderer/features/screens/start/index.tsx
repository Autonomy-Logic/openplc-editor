import {
	FolderIcon,
	PlusIcon,
	StickArrowIcon,
	VideoIcon,
} from '~renderer/assets/icons'
import { MenuComponent } from '~renderer/components/ui'

import { useNavigate } from 'react-router-dom'
import { useOpenPLCStore } from '~renderer/store'
import {
	ActionsBar,
	DisplayExampleProjects,
	DisplayRecentProjects,
} from './components'

export default function Start() {
	const navigate = useNavigate()
	const setWorkspace = useOpenPLCStore.useSetWorkspace()

	const handleProject = async (channel: string) => {
		if (channel === 'project:create') {
			const { ok, data } = await window.bridge.startCreateProject()
			if (ok && data) {
				const { path, xmlAsObject } = data
				const dataToWorkspace = xmlAsObject.toString()
				setWorkspace({
					path: path,
					name: 'new-project',
					data: dataToWorkspace,
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				})
				navigate('workspace')
			}
		} else if (channel === 'project:open') {
			const { ok, data } = await window.bridge.startOpenProject()
			if (ok && data) {
				const { path, xmlAsObject } = data
				const dataToWorkspace = xmlAsObject.toString()
				setWorkspace({
					path: path,
					name: 'new-project',
					data: dataToWorkspace,
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				})
				navigate('workspace')
			}
		}
	}

	return (
		<>
			<aside className='relative top-[63%] 2xl:top-2/3  min-w-[240px] ml-16'>
				<MenuComponent.Root>
					<MenuComponent.Section className='flex-col gap-2'>
						<MenuComponent.Button
							onClick={() => handleProject('project:create')}
						>
							{' '}
							<PlusIcon className='stroke-white' /> New Project{' '}
						</MenuComponent.Button>
						<MenuComponent.Button
							ghosted
							onClick={() => handleProject('project:open')}
						>
							{' '}
							<FolderIcon /> Open
						</MenuComponent.Button>
						<MenuComponent.Button ghosted>
							{' '}
							<VideoIcon /> Tutorials{' '}
						</MenuComponent.Button>
					</MenuComponent.Section>
					<MenuComponent.Divider />
					<MenuComponent.Section>
						<MenuComponent.Button ghosted>
							<StickArrowIcon className='rotate-180' /> Quit
						</MenuComponent.Button>
					</MenuComponent.Section>
				</MenuComponent.Root>
			</aside>
			<div className='w-full my-4 max-w-3xl xl:max-w-5xl 2xl:max-w-7xl 3xl:max-w-[1536px] 4xl:max-w-[1996px] h-full mb-2'>
				<ActionsBar />
				<DisplayExampleProjects />
				<DisplayRecentProjects />
			</div>
		</>
	)
}
