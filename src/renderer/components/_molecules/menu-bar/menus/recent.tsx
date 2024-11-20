import * as MenuPrimitive from '@radix-ui/react-menubar'
import RecentProjectIcon from '@root/renderer/assets/icons/interface/Recent'
import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import { useOpenPLCStore } from '@root/renderer/store'
import type { FlowType } from '@root/renderer/store/slices'
import { cn } from '@root/utils'
import _ from 'lodash'
import { useEffect, useState } from 'react'

import { MenuClasses } from '../constants'

export const RecentMenu = () => {
  const {
    workspace: { recents },
    editorActions: { clearEditor },
    workspaceActions: { setEditingState, setRecents },
    tabsActions: { clearTabs },
    projectActions: { setProject },
    flowActions: { addFlow },
    libraryActions: { addLibrary },
  } = useOpenPLCStore()
  const { TRIGGER, CONTENT, ITEM } = MenuClasses

  const [recentProjects, setRecentProjects] = useState(recents)
  const [projectTimes, setProjectTimes] = useState<{ [key: string]: string }>({})

  const getUserRecentProjects = async () => {
    const recentProjects = await window.bridge.retrieveRecents()
    setRecentProjects(recentProjects)
  }

  useEffect(() => {
    void getUserRecentProjects()
  }, [recents])

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
  }, [recentProjects])

  const handleOpenProject = async (projectPath: string) => {
    const { success, data, error } = await window.bridge.openProjectByPath(projectPath)

    if (success && data) {
      clearEditor()
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
      if (ladderPous.length > 0) {
        ladderPous.forEach((pou) => {
          if (pou.data.body.language === 'ld') addFlow(pou.data.body.value as FlowType)
        })
      }
      data.content.data.pous.map((pou) => pou.type !== 'program' && addLibrary(pou.data.name, pou.type))

      toast({
        title: 'Project opened!',
        description: 'Your project was opened and loaded.',
        variant: 'default',
      })
    } else {
      if (error?.description.includes('Error reading project file.')) {
        void getUserRecentProjects()
        toast({
          title: 'Path does not exist.',
          description: `The path ${projectPath} does not exist on this computer.`,
          variant: 'fail',
        })
      } else {
        void getUserRecentProjects(),
          toast({
            title: 'Cannot open the project.',
            description: error?.description,
            variant: 'fail',
          })
      }
    }
  }
  return (
    <MenuPrimitive.Menu>
      <MenuPrimitive.Trigger className={TRIGGER}>recent</MenuPrimitive.Trigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Content sideOffset={16} className={CONTENT}>
          {recentProjects.map((project) => (
            <MenuPrimitive.Item
              onClick={() => void handleOpenProject(project.path)}
              key={project.path}
              className={cn(
                ITEM,
                'flex items-center justify-normal gap-2 !overflow-hidden text-xs font-medium text-neutral-900 dark:text-neutral-50',
              )}
            >
              <RecentProjectIcon />
              <span className='flex-1 overflow-hidden capitalize'>{project.path}</span>
              <span className='text-cp-sm font-normal text-neutral-400'>{projectTimes[project.path]}</span>
            </MenuPrimitive.Item>
          ))}
        </MenuPrimitive.Content>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Menu>
  )
}
