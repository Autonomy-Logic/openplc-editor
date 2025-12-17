import * as MenuPrimitive from '@radix-ui/react-menubar'
import RecentProjectIcon from '@root/renderer/assets/icons/interface/Recent'
import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import _ from 'lodash'
import { useEffect, useState } from 'react'

import { MenuClasses } from '../constants'

export const RecentMenu = () => {
  const {
    workspace: { recent, editingState },
    workspaceActions: { setRecent },
    modalActions: { openModal },
    sharedWorkspaceActions: { openProjectByPath },
  } = useOpenPLCStore()
  const { TRIGGER, CONTENT, ITEM } = MenuClasses

  const [recentProjects, setRecentProjects] = useState(recent)
  const [projectTimes, setProjectTimes] = useState<{ [key: string]: string }>({})

  useEffect(() => {
    setRecentProjects(recent)
  }, [recent])

  const updateUserRecentProjects = async () => {
    const recentProjects = await window.bridge.retrieveRecent()
    setRecent(recentProjects)
  }

  const compareLastOpened = (lastOpenedAt: string) => {
    const currentTime = new Date()
    const lastOpenedDate = new Date(lastOpenedAt)

    const differenceInMs = currentTime.getTime() - lastOpenedDate.getTime()

    const differenceInMinutes = Math.floor(differenceInMs / (1000 * 60))
    const differenceInHours = Math.floor(differenceInMs / (1000 * 60 * 60))
    const differenceInDays = Math.floor(differenceInMs / (1000 * 60 * 60 * 24))

    if (differenceInMinutes < 60) {
      return `${differenceInMinutes} minutes ago`
    } else if (differenceInHours < 24) {
      return `${differenceInHours} hours ago`
    } else {
      return `${differenceInDays} days ago`
    }
  }

  const updateProjectTimes = () => {
    const updatedTimes = recentProjects.reduce(
      (acc, project) => {
        acc[project.path] = compareLastOpened(project.lastOpenedAt)
        return acc
      },
      {} as { [key: string]: string },
    )

    setProjectTimes(updatedTimes)
  }

  useEffect(() => {
    updateProjectTimes()

    const timers = recentProjects.map((project) => {
      const lastOpenedDate = new Date(project.lastOpenedAt)
      const now = new Date()

      const timeSinceLastOpened = now.getTime() - lastOpenedDate.getTime()
      const timeUntilNextMinute = 60000 - (timeSinceLastOpened % 60000)

      const timerId = setTimeout(() => {
        updateProjectTimes()

        setInterval(() => {
          updateProjectTimes()
        }, 60000)
      }, timeUntilNextMinute)

      return timerId
    })

    return () => {
      timers.forEach((timerId) => clearTimeout(timerId))
    }
  }, [recent])

  const handleOpenProjectByPath = async (projectPath: string) => {
    switch (editingState) {
      case 'unsaved':
        openModal('save-changes-project', {
          validationContext: 'open-project-by-path',
          projectPath,
        })
        return
      case 'save-request':
        toast({
          title: 'Save in progress',
          description: 'Please wait for the current save operation to complete.',
          variant: 'warn',
        })
        return
      default:
        break
    }

    const { success, error } = await openProjectByPath(projectPath)
    if (!success) {
      if (error?.description.includes('Error reading project file.')) {
        void updateUserRecentProjects()
        toast({
          title: 'Path does not exist.',
          description: `The path ${projectPath} does not exist on this computer.`,
          variant: 'fail',
        })
        return
      }
      void updateUserRecentProjects()
      toast({
        title: 'Cannot open the project.',
        description: error?.description,
        variant: 'fail',
      })
    }
  }
  return (
    <MenuPrimitive.Menu>
      <MenuPrimitive.Trigger className={TRIGGER}>Recent</MenuPrimitive.Trigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Content sideOffset={16} className={CONTENT}>
          {recentProjects.map((project) => (
            <MenuPrimitive.Item
              onClick={() => void handleOpenProjectByPath(project.path)}
              key={project.path}
              className={cn(
                ITEM,
                'flex items-center justify-normal gap-2 !overflow-hidden text-xs font-medium text-neutral-900 dark:text-neutral-50',
              )}
            >
              <RecentProjectIcon className='h-4 w-4' />
              <span className='flex-1 overflow-hidden text-xs'>{project.name}</span>
              <span className='flex-1 overflow-hidden text-cp-xs'>{project.path}</span>
              <span className='text-cp-xs font-normal text-neutral-400'>{projectTimes[project.path]}</span>
            </MenuPrimitive.Item>
          ))}
        </MenuPrimitive.Content>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Menu>
  )
}
