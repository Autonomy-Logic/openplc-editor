/* eslint-disable @typescript-eslint/require-await */
import { useEffect, useState } from 'react'

import { FolderIcon, PlusIcon, StickArrowIcon, VideoIcon } from '../assets'
import { MenuDivider, MenuItem, MenuRoot, MenuSection } from '../components/_features/[start]/menu'
import DisplayRecentProjects from '../components/_organisms/display-recent-projects'
import { ProjectFilterBar } from '../components/_organisms/project-filter-bar'
import { StartMainContent, StartSideContent } from '../components/_templates'
import { useOpenPLCStore } from '../store'

const StartScreen = () => {
  const [searchFilterValue, setSearchFilterProps] = useState<string>('')

  const {
    workspaceActions: { setRecent },
    modalActions: { openModal },
    sharedWorkspaceActions: { openProject },
  } = useOpenPLCStore()

  const handleCreateProject = async () => {
    openModal('create-project', null)
  }

  const handleOpenProject = () => {
    void openProject()
  }

  const searchFilter = (searchFilterValue: string) => {
    setSearchFilterProps(searchFilterValue)
  }

  const handleExitAppRequest = () => {
    window.bridge.handleCloseOrHideWindow()
  }

  useEffect(() => {
    const getUserRecentProjects = async () => {
      const recentProjects = await window.bridge.retrieveRecent()
      setRecent(recentProjects)
    }
    void getUserRecentProjects()
  }, [])

  const handleDebug = async () => {
    await window.bridge.debugIpc('Raspberry Pico W"', '1.0.0', '2025-02-18')
  }

  return (
    <>
      <StartSideContent>
        <MenuRoot>
          <MenuSection id='1'>
            <MenuItem onClick={() => void handleCreateProject()}>
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
          <MenuSection id='2'>
            <MenuItem onClick={handleDebug} ghosted>
              <StickArrowIcon className='rotate-180 stroke-brand' /> debug
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
