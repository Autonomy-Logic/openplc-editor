import { IProjectServiceResponse } from '@root/main/services/project-service'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { FolderIcon, PlusIcon, StickArrowIcon, VideoIcon } from '../assets'
import { useToast } from '../components/_features/[app]/toast/use-toast'
import { MenuDivider, MenuItem, MenuRoot, MenuSection } from '../components/_features/[start]/menu'
import { ProjectModal } from '../components/_features/[start]/new-project/project-modal'
import DisplayRecentProjects from '../components/_organisms/display-recent-projects'
import { ProjectFilterBar } from '../components/_organisms/project-filter-bar'
import { StartMainContent, StartSideContent } from '../components/_templates'
import { useOpenPLCStore } from '../store'
import { FlowType } from '../store/slices/flow/types'

const StartScreen = () => {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const { toast } = useToast()
  const navigate = useNavigate()
  const {
    workspaceActions: { setEditingState },
    projectActions: { setProject },
    tabsActions: { clearTabs },
    flowActions: { addFlow },
  } = useOpenPLCStore()

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

        const ladderPous = projectData.pous.filter((pou) => pou.data.language === 'ld')
        if (ladderPous.length) {
          ladderPous.forEach((pou) => {
            if (pou.data.body.language === 'ld') {
              addFlow(pou.data.body.value as FlowType)
            }
          })
        }

        navigate('/workspace')
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
    const handleOpenProjectAccelerator = () => {
      window.bridge.openProjectAccelerator((_event, response: IProjectServiceResponse) => {
        const { data, error } = response
        if (data) {
          clearTabs()
          setEditingState('unsaved')
          setProject({
            meta: {
              name: data.content.meta.name,
              type: data.content.meta.type,
              path: data.meta.path,
            },
            data: data.content.data,
          })

          const ladderPous = data.content.data.pous.filter((pou) => pou.data.language === 'ld')
          if (ladderPous.length) {
            ladderPous.forEach((pou) => {
              if (pou.data.body.language === 'ld') addFlow(pou.data.body.value as FlowType)
            })
          }

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
    handleOpenProjectAccelerator()
  }, [])

  return (
    <>
      <StartSideContent>
        <MenuRoot>
          <MenuSection id='1'>
            <MenuItem onClick={() => setIsModalOpen(true)}>
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
            <MenuItem ghosted>
              <StickArrowIcon className='rotate-180 stroke-brand' /> Quit
            </MenuItem>
          </MenuSection>
        </MenuRoot>
      </StartSideContent>
      <StartMainContent>
        <ProjectFilterBar />
        <DisplayRecentProjects />
      </StartMainContent>
      <ProjectModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </>
  )
}

export { StartScreen }
