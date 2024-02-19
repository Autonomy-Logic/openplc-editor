import {
	FolderIcon,
	PlusIcon,
	StickArrowIcon,
	VideoIcon,
} from '~renderer/assets/icons'
import { MenuComponent } from '~renderer/components/ui'

import { useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { TXmlProject } from '~/shared/contracts/types'
import { useOpenPLCStore } from '~renderer/store'
import {
	ActionsBar,
	Container,
	DisplayExampleProjects,
	DisplayRecentProjects,
} from './components'

export default function Start() {
	const navigate = useNavigate()
	const setWorkspaceData = useOpenPLCStore.useSetWorkspace()

	const handleProject = async (channel: string) => {
		if (channel === 'project:create') {
			const { ok, data } = await window.bridge.startCreateProject()
			if (ok && data) {
				const { path, xmlAsObject } = data
				setWorkspaceData({ projectPath: path, projectData: xmlAsObject })
				navigate('editor')
				console.log(data)
				console.log('new project:', data)
			}
		} else if (channel === 'project:open') {
			const { ok, data } = await window.bridge.startOpenProject()
			if (ok && data) {
				const { path: projectPath, xmlAsObject: projectAsObj } = data
				setWorkspaceData({ projectPath, projectData: projectAsObj })
				navigate('editor')
				console.log('open:', data)
			}
		}
	}

	return (
		<Container>
			<aside className='relative top-[63%] 2xl:top-2/3  min-w-[240px]  '>
				<MenuComponent.Root>
					<MenuComponent.Section className='flex-col gap-2'>
						<MenuComponent.Button
							onClick={() => handleProject('project:create')}
							label='New Project'
							icon={<PlusIcon />}
							className='w-48 h-12 text-white bg-brand rounded-md flex items-center hover:bg-brand-medium-dark focus:bg-brand-medium font-caption text-xl font-normal px-5 py-3 gap-3'
						/>
						<MenuComponent.Button
							onClick={() => handleProject('project:open')}
							label='Open'
							icon={<FolderIcon />}
							className='w-48 h-12 text-neutral-1000 dark:text-white dark:hover:text-brand hover:text-brand bg-transparent flex items-center justify-start hover:opacity-90 font-caption text-xl font-medium py-3 gap-3'
						/>
						<MenuComponent.Button
							label='Tutorials'
							icon={<VideoIcon />}
							className='w-48 h-12 text-neutral-1000 dark:text-white dark:hover:text-brand hover:text-brand bg-transparent flex items-center justify-start hover:opacity-90 font-caption text-xl font-medium py-3 gap-3'
						/>
					</MenuComponent.Section>
					<MenuComponent.Divider />
					<MenuComponent.Section>
						<MenuComponent.Button
							label='Quit'
							icon={<StickArrowIcon className='rotate-180' />}
							className='w-48 h-12 text-neutral-1000 dark:text-white dark:hover:text-brand hover:text-brand bg-transparent flex items-center justify-start hover:opacity-90 font-caption text-xl font-medium py-3 gap-3'
						/>
					</MenuComponent.Section>
				</MenuComponent.Root>
			</aside>
			<div className=' w-full max-w-3xl xl:max-w-5xl 2xl:max-w-7xl 3xl:max-w-[1536px] 4xl:max-w-[1996px] h-full mb-2'>
				<ActionsBar />
				<DisplayExampleProjects />
				<DisplayRecentProjects />
			</div>
		</Container>
	)
}
