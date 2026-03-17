import * as MenuPrimitive from '@radix-ui/react-menubar'

import { cn } from '../../../utils/cn'
import { MenuClasses } from './constants'
import { DisplayMenu } from './menus/display'
import { EditMenu } from './menus/edit'
import { FileMenu } from './menus/file'
import { HelpMenu } from './menus/help'
import { RecentMenu } from './menus/recent'

const MenuBar = () => {
  const { SEPARATOR } = MenuClasses
  return (
    <MenuPrimitive.Root id='menu-bar' className='ml-6 flex h-full flex-1 items-center gap-2'>
      <FileMenu />
      <EditMenu />
      <DisplayMenu />
      <HelpMenu />
      <MenuPrimitive.Separator className={cn(SEPARATOR, 'h-[1px] w-3 rotate-90 bg-brand-light')} />
      <RecentMenu />
    </MenuPrimitive.Root>
  )
}

export { MenuBar }
