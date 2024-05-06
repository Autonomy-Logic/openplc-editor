/* eslint-disable @typescript-eslint/no-misused-promises */
import { useNavigate } from 'react-router-dom'

import { FolderIcon, PlusIcon, StickArrowIcon, VideoIcon } from '../assets'
import { MenuDivider, MenuItem, MenuRoot, MenuSection } from '../components/_features/[start]/menu'
import { ProjectFilterBar } from '../components/_organisms/project-filter-bar'
import { StartMainContent, StartSideContent } from '../components/_templates'
import { useOpenPLCStore } from '../store'

const StartScreen = () => {
  const navigate = useNavigate()
  const {
    workspaceActions: { setUserWorkspace },
  } = useOpenPLCStore()

  const handleCreateProject = async () => {
    const { success, data, error } = await window.bridge.startCreateProject()
    if (success && data) {
      setUserWorkspace({
        editingState: 'unsaved',
        projectPath: data.meta.path,
        projectData: data.content,
        projectName: 'new-project',
      })
      navigate('/workspace')
    } else {
      console.log('Cannot create project:', error)
    }
  }

  // const handleOpenProject = async () => {}

  return (
    <>
      <StartSideContent>
        <MenuRoot>
          <MenuSection id='1'>
            <MenuItem onClick={() => handleCreateProject()}>
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
        <ProjectFilterBar />
      </StartMainContent>
    </>
  )
}
export { StartScreen }
