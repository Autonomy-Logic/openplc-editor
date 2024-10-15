import { IProjectServiceResponse } from '@root/main/services/project-service'
import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { FolderIcon, PlusIcon, StickArrowIcon, VideoIcon } from '../assets'
import { useToast } from '../components/_features/[app]/toast/use-toast'
import { MenuDivider, MenuItem, MenuRoot, MenuSection } from '../components/_features/[start]/menu'
import { ProjectModal } from '../components/_features/[start]/new-project/project-modal'
import { ProjectFilterBar } from '../components/_organisms/project-filter-bar'
import { StartMainContent, StartSideContent } from '../components/_templates'
import { useOpenPLCStore } from '../store'
import { FlowType } from '../store/slices/flow/types'

const StartScreen = () => {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const { toast } = useToast()
  const navigate = useNavigate()
  const {
    workspaceActions: { setEditingState, setRecents },
    projectActions: { setProject },
    tabsActions: { clearTabs },
    flowActions: { addFlow },
  } = useOpenPLCStore()

  const retrieveNewProjectData = async () => {
    const { success, data, error } = await window.bridge.createProject()

    if (success && data) {
      clearTabs()
      setEditingState('unsaved')
      setRecents([])
      setProject({
        meta: {
          name: data.content.meta.name,
          type: data.content.meta.type,
          path: data.meta.path,
        },
        data: data.content.data,
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

  const handleCreateProject = () => {
    void retrieveNewProjectData()
  }

  const retrieveOpenProjectData = async () => {
    const { success, data, error } = await window.bridge.openProject()
    if (success && data) {
      clearTabs()
      setEditingState('unsaved')
      setRecents([])
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
  }

  const handleOpenProject = () => {
    void retrieveOpenProjectData()
  }

  useEffect(() => {
    const handleCreateProjectAccelerator = () => {
      window.bridge.createProjectAccelerator((_event, response: IProjectServiceResponse) => {
        const { data, error } = response
        if (data) {
          clearTabs()
          setEditingState('unsaved')
          setRecents([])
          setProject({
            meta: {
              name: data.content.meta.name,
              type: data.content.meta.type,
              path: data.meta.path,
            },
            data: data.content.data,
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
          clearTabs()
          setEditingState('unsaved')
          setRecents([])
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
    handleCreateProjectAccelerator()
    handleOpenProjectAccelerator()
  }, [])

  return (
    <>
      <StartSideContent>
        <MenuRoot>
          <MenuSection id='1'>
            <MenuItem onClick={handleCreateProject}>
              <PlusIcon className='stroke-white' /> New Project
            </MenuItem>
            <MenuItem ghosted onClick={handleOpenProject}>
              <FolderIcon /> Open
            </MenuItem>
            <MenuItem ghosted onClick={() => setIsModalOpen(true)}>
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
      </StartMainContent>
      <ProjectModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </>
  )
}

export { StartScreen }
