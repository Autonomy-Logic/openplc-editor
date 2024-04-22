import { MenuComponent } from '@components/ui'
import { FolderIcon, PlusIcon, StickArrowIcon, VideoIcon } from '@process:renderer/assets/icons'
import { useOpenPLCStore } from '@process:renderer/store'
import { useNavigate } from 'react-router-dom'

import { ActionsBar, DisplayExampleProjects, DisplayRecentProjects } from './components'

export default function Start() {
  const navigate = useNavigate()
  const { setWorkspace } = useOpenPLCStore()

  const handleProject = async (channel: string) => {
    if (channel === 'project:create') {
      const { ok, res } = await window.bridge.startCreateProject()
      if (ok && res) {
        const { path, data } = res
        setWorkspace({
          path,
          projectName: 'new-project',
          data,
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
          projectName: 'new-project',
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
            <MenuComponent.Button onClick={() => handleProject('project:create')}>
              {' '}
              <PlusIcon className='stroke-white' /> New Project{' '}
            </MenuComponent.Button>
            <MenuComponent.Button ghosted onClick={() => handleProject('project:open')}>
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
      <div className='w-full h-full mb-2 my-4 max-w-3xl xl:max-w-5xl 2xl:max-w-7xl xm:max-w-[1520px] 3xl:max-w-[1532px] 4xl:max-w-[1990px]'>
        <ActionsBar />
        <DisplayExampleProjects />
        <DisplayRecentProjects />
      </div>
    </>
  )
}
