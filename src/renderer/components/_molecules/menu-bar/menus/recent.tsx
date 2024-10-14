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
    workspace: { recents },
    editorActions: { clearEditor },
    workspaceActions: { setUserWorkspace },
    tabsActions: { clearTabs },
  } = useOpenPLCStore()
  const { TRIGGER, CONTENT, ITEM } = MenuClasses
  const [recentProjects, setRecentProjects] = useState(recents)

  const getUserRecentProjects = async () => {
    const recentProjects = await window.bridge.retrieveRecents()
    setRecentProjects(recentProjects)
  }

  useEffect(() => {
    void getUserRecentProjects()
  }, [recents])

  const handleOpenProject = async (projectPath: string) => {
    const { success, data, error } = await window.bridge.openProjectByPath(projectPath)

    if (success && data) {
      setUserWorkspace({
        editingState: 'unsaved',
        projectPath: data.meta.path,
        projectData: data.content,
        projectName: 'new-project',
        recents: [],
      })
      clearEditor()
      clearTabs()
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
              <span className='text-cp-sm font-normal text-neutral-400'>edited 0 minute ago</span>
            </MenuPrimitive.Item>
          ))}
        </MenuPrimitive.Content>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Menu>
  )
}
