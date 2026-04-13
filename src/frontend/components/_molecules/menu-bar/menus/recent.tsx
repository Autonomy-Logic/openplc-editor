import * as MenuPrimitive from '@radix-ui/react-menubar'

import { cn } from '../../../../utils/cn'
import { MenuClasses } from '../constants'

export const RecentMenu = () => {
  const { TRIGGER, CONTENT, ITEM } = MenuClasses

  return (
    <MenuPrimitive.Menu>
      <MenuPrimitive.Trigger className={TRIGGER}>Recent</MenuPrimitive.Trigger>
      <MenuPrimitive.Portal>
        <MenuPrimitive.Content sideOffset={16} className={CONTENT}>
          <MenuPrimitive.Item
            className={cn(
              ITEM,
              'flex items-center justify-normal gap-2 !overflow-hidden text-xs font-medium text-neutral-900 dark:text-neutral-50',
            )}
            disabled
          >
            <span className='flex-1 overflow-hidden text-xs opacity-50'>No recent projects</span>
          </MenuPrimitive.Item>
        </MenuPrimitive.Content>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Menu>
  )
}
