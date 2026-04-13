import { useEffect, useState } from 'react'

import { useCapabilities, useDevice, useProject, useSystem, useWindow } from '../../middleware/shared/providers'
import { FolderIcon } from '../assets/icons/interface/Folder'
import { PlusIcon } from '../assets/icons/interface/Plus'
import { StickArrowIcon } from '../assets/icons/interface/StickArrow'
import { VideoIcon } from '../assets/icons/interface/Video'
import { MenuDivider, MenuItem, MenuRoot, MenuSection } from '../components/_features/[start]/menu'
import DisplayRecentProjects from '../components/_organisms/display-recent-projects'
import { ProjectFilterBar } from '../components/_organisms/project-filter-bar'
import { StartMainContent } from '../components/_templates/[start]/main-content'
import { StartSideContent } from '../components/_templates/[start]/side-content'
import { useOpenPLCStore } from '../store'

const StartScreen = () => {
  const [searchFilterValue, setSearchFilterProps] = useState<string>('')
  const capabilities = useCapabilities()
  useSystem()
  const projectPort = useProject()
  const device = useDevice()
  const windowPort = useWindow()

  const {
    workspaceActions: { setRecent },
    modalActions: { openModal },
    deviceActions: { setAvailableOptions },
    sharedWorkspaceActions: { handleOpenProjectResponse },
  } = useOpenPLCStore()

  const handleCreateProject = () => {
    openModal('create-project', null)
  }

  const handleOpenProject = async () => {
    const result = await projectPort.openProject()
    if (result.success && result.data) {
      handleOpenProjectResponse(result.data)
    }
  }

  const searchFilter = (value: string) => {
    setSearchFilterProps(value)
  }

  const handleExitAppRequest = () => {
    windowPort.close()
  }

  // Load recent projects
  useEffect(() => {
    const loadRecent = async () => {
      const recentProjects = await projectPort.getRecentProjects()
      setRecent(recentProjects)
    }
    void loadRecent()
  }, [projectPort, setRecent])

  // Load available communication ports (editor-only, harmless no-op on web)
  useEffect(() => {
    let isMounted = true

    const loadPorts = async () => {
      const ports = await device.getCommunicationPorts()
      if (isMounted) {
        setAvailableOptions({ availableCommunicationPorts: ports })
      }
    }
    void loadPorts()

    return () => {
      isMounted = false
    }
  }, [device, setAvailableOptions])

  // Web: show welcome message when no local filesystem
  if (!capabilities.hasLocalFilesystem) {
    return (
      <div className='flex h-full w-full items-center justify-center bg-neutral-950'>
        <div className='flex flex-col items-center gap-6 text-center'>
          <div className='flex flex-col items-center gap-2'>
            <h1 className='text-2xl font-semibold text-neutral-100'>Welcome to OpenPLC Editor</h1>
            <p className='max-w-md text-neutral-400'>
              No project is currently loaded. Please provide a project ID in the URL to load a project.
            </p>
          </div>
          <div className='rounded-lg border border-neutral-800 bg-neutral-900 p-4'>
            <p className='text-sm text-neutral-500'>
              Example: <code className='text-brand'>?project_id=your-project-id</code>
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Editor: show menu + recent projects
  return (
    <>
      <StartSideContent>
        <MenuRoot>
          <MenuSection id='1'>
            <MenuItem onClick={() => handleCreateProject()}>
              <PlusIcon className='stroke-white' /> New Project
            </MenuItem>
            <MenuItem ghosted onClick={handleOpenProject}>
              <FolderIcon /> Open
            </MenuItem>
            <MenuItem ghosted>
              <VideoIcon /> Tutorials
            </MenuItem>
          </MenuSection>
          <MenuDivider />
          <MenuSection id='2'>
            <MenuItem onClick={handleExitAppRequest} ghosted>
              <StickArrowIcon className='rotate-180 stroke-brand' /> Exit
            </MenuItem>
          </MenuSection>
        </MenuRoot>
      </StartSideContent>
      <StartMainContent>
        <ProjectFilterBar setSearchFilterValue={searchFilter} />
        <DisplayRecentProjects searchNameFilterValue={searchFilterValue} />
      </StartMainContent>
    </>
  )
}

export { StartScreen }
