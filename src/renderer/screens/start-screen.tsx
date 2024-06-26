/* eslint-disable @typescript-eslint/no-misused-promises */
import { IProjectServiceResponse } from '@root/main/services/project-service'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

import { FolderIcon, PlusIcon, StickArrowIcon, VideoIcon } from '../assets'
import { useToast } from '../components/_features/[app]/toast/use-toast'
import { MenuDivider, MenuItem, MenuRoot, MenuSection } from '../components/_features/[start]/menu'
import { ProjectFilterBar } from '../components/_organisms/project-filter-bar'
import { StartMainContent, StartSideContent } from '../components/_templates'
import { useOpenPLCStore } from '../store'

const StartScreen = () => {
  const { toast } = useToast()
  const navigate = useNavigate()
  const {
    workspaceActions: { setUserWorkspace },
  } = useOpenPLCStore()

  const handleCreateProject = async () => {
    const { success, data, error } = await window.bridge.createProject()
    if (success && data) {
      setUserWorkspace({
        editingState: 'unsaved',
        projectPath: data.meta.path,
        projectData: data.content,
        projectName: 'new-project',
      })
      navigate('/workspace')
      toast({
        title: 'The project was created successfully!',
        description: 'To begin using the OpenPLC Editor, add a new POU to your project.',
        variant: 'default',
      })
    } else {
      toast({
        title: 'Cannot create a project!',
        description: error?.description,
        variant: 'fail',
      })
    }
  }

  const handleOpenProject = async () => {
    const { success, data, error } = await window.bridge.openProject()
    console.log(success, data, error)
    if (success && data) {
      setUserWorkspace({
        editingState: 'unsaved',
        projectPath: data.meta.path,
        projectData: data.content,
        projectName: 'new-project',
      })
      navigate('/workspace')
      toast({
        title: 'Project opened!',
        description: 'Your project was opened, and loaded.',
        variant: 'default',
      })
    } else {
      toast({
        title: 'Cannot open the project.',
        description: error?.description,
        variant: 'fail',
      })
    }
  }

  useEffect(() => {
    const handleCreateProjectAccelerator = () => {
      window.bridge.createProjectAccelerator((_event, response: IProjectServiceResponse) => {
        const { data, error } = response
        if (data) {
          setUserWorkspace({
            editingState: 'unsaved',
            projectPath: data.meta.path,
            projectData: data.content,
            projectName: 'new-project',
          })
          navigate('/workspace')
          toast({
            title: 'The project was created successfully!',
            description: 'To begin using the OpenPLC Editor, add a new POU to your project.',
            variant: 'default',
          })
        } else {
          toast({
            title: 'Cannot create a project!',
            description: error?.description,
            variant: 'fail',
          })
        }
      })
    }
    const handleOpenProjectAccelerator = () => {
      window.bridge.openProjectAccelerator((_event, response: IProjectServiceResponse) => {
        const { data, error } = response
        if (data) {
          setUserWorkspace({
            editingState: 'unsaved',
            projectPath: data.meta.path,
            projectData: data.content,
            projectName: 'new-project',
          })
          navigate('/workspace')
          toast({
            title: 'Project opened!',
            description: 'Your project was opened, and loaded.',
            variant: 'default',
          })
        } else {
          toast({
            title: 'Cannot open the project.',
            description: error?.description,
            variant: 'fail',
          })
        }
      })
    }

    handleCreateProjectAccelerator()
    handleOpenProjectAccelerator()
  }, [])

  return (
    <>
      <StartSideContent>
        <MenuRoot>
          <MenuSection id='1'>
            <MenuItem onClick={() => handleCreateProject()}>
              <PlusIcon className='stroke-white' /> New Project
            </MenuItem>
            <MenuItem ghosted onClick={() => handleOpenProject()}>
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
