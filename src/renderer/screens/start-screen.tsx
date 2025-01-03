/* eslint-disable @typescript-eslint/require-await */
import { IProjectServiceResponse } from '@root/main/services/project-service'
import { useEffect } from 'react'

import { FolderIcon, PlusIcon, StickArrowIcon, VideoIcon } from '../assets'
import { useToast } from '../components/_features/[app]/toast/use-toast'
import { MenuDivider, MenuItem, MenuRoot, MenuSection } from '../components/_features/[start]/menu'
import DisplayRecentProjects from '../components/_organisms/display-recent-projects'
import { ProjectFilterBar } from '../components/_organisms/project-filter-bar'
import { StartMainContent, StartSideContent } from '../components/_templates'
import { useOpenPLCStore } from '../store'
import { FlowType } from '../store/slices/flow/types'

const StartScreen = () => {
  const { toast } = useToast()
  const {
    workspaceActions: { setEditingState },
    projectActions: { setProject },
    tabsActions: { clearTabs },
    flowActions: { addFlow },
    libraryActions: { addLibrary },
    modalActions: { openModal },
    workspace: {
      systemConfigs: { OS },
    },
  } = useOpenPLCStore()

  const handleCreateProject = async () => {
    openModal('create-project', null)
  }

  const retrieveOpenProjectData = async () => {
    try {
      const { success, data, error } = await window.bridge.openProject()
      if (success && data) {
        clearTabs()
        setEditingState('unsaved')
        const projectMeta = {
          name: data.content.meta.name,
          type: data.content.meta.type,
          path: data.meta.path,
        }

        const projectData = data.content.data

        setProject({
          meta: projectMeta,
          data: projectData,
        })

        const ladderPous = projectData.pous.filter((pou: { data: { language: string } }) => pou.data.language === 'ld')
        if (ladderPous.length) {
          ladderPous.forEach((pou) => {
            if (pou.data.body.language === 'ld') {
              addFlow(pou.data.body.value as FlowType)
            }
          })
        }
        data.content.data.pous.map((pou) => pou.type !== 'program' && addLibrary(pou.data.name, pou.type))

        toast({
          title: 'Project opened!',
          description: 'Your project was opened and loaded successfully.',
          variant: 'default',
        })
      } else {
        toast({
          title: 'Cannot open the project.',
          description: error?.description || 'Failed to open the project.',
          variant: 'fail',
        })
      }
    } catch (_error) {
      toast({
        title: 'An error occurred.',
        description: 'There was a problem opening the project.',
        variant: 'fail',
      })
    }
  }

  const handleOpenProject = () => {
    void retrieveOpenProjectData()
  }
  useEffect(() => {
    const handleOpenRecentAccelerator = () => {
      window.bridge.openRecentAccelerator((_event, response: IProjectServiceResponse) => {
        const { data, error } = response
        if (data) {
          clearTabs()
          setEditingState('unsaved')
          const projectMeta = {
            name: data.content.meta.name,
            type: data.content.meta.type,
            path: data.meta.path,
          }
          const projectData = data.content.data

          setProject({
            meta: projectMeta,
            data: projectData,
          })

          const ladderPous = projectData.pous.filter((pou) => pou.data.language === 'ld')

          if (ladderPous.length) {
            ladderPous.forEach((pou) => {
              if (pou.data.body.language === 'ld') {
                addFlow(pou.data.body.value as FlowType)
              }
            })
          }

          projectData.pous.map((pou) => pou.type !== 'program' && addLibrary(pou.data.name, pou.type))

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
    void handleOpenRecentAccelerator()
  }, [])

  const handleExitAppRequest = () => {
    OS === 'darwin' ? window.bridge.hideWindow() : window.bridge.closeWindow()
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
        </MenuRoot>
      </StartSideContent>
      <StartMainContent>
        <ProjectFilterBar />
        <DisplayRecentProjects />
      </StartMainContent>
    </>
  )
}

export { StartScreen }
