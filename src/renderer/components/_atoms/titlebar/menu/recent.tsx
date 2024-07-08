import * as MenuPrimitive from '@radix-ui/react-menubar'
import RecentProjectIcon from '@root/renderer/assets/icons/interface/Recent'
import { cn } from '@root/utils'
import _ from 'lodash'

import { contentDefaultStyle, itemDefaultStyle, triggerDefaultStyle } from './styles'

export const RecentMenu = () => {
  const recentProjects = [
    'project-1',
    'project-2',
    'project-3',
    'project-4',
    'project-5',
    'project-6',
    'project-7',
    'project-8',
    'project-9',
    'project-10',
  ]

  return (
    <MenuPrimitive.Menu>
      <MenuPrimitive.Trigger className={triggerDefaultStyle}>recent</MenuPrimitive.Trigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Content sideOffset={16} className={contentDefaultStyle}>
          {recentProjects.map((project) => (
            <MenuPrimitive.Item
              key={project}
              className={cn(
                itemDefaultStyle,
                'flex items-center justify-normal gap-2 !overflow-hidden text-xs font-medium text-neutral-900 dark:text-neutral-50',
              )}
            >
              <RecentProjectIcon />
              <span className='flex-1 overflow-hidden capitalize'>{project}</span>
              <span className='text-cp-sm font-normal text-neutral-400'>edited 0 minute ago</span>
            </MenuPrimitive.Item>
          ))}
        </MenuPrimitive.Content>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Menu>
  )
}
