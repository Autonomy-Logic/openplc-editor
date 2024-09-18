import {
  DisplayMenu,
  EditMenu,
  FileMenu,
  HelpMenu,
  RecentMenu,
} from '@process:renderer/components/_atoms/titlebar/menu'
import * as MenuPrimitive from '@radix-ui/react-menubar'
import { separatorDefaultStyle } from '@root/renderer/components/_atoms/titlebar/menu/styles'
import { cn } from '@root/utils'
import _ from 'lodash'

export const MenuBar = () => {
  return (
    <MenuPrimitive.Root className='ml-6 flex h-full flex-1 items-center gap-2'>
      <FileMenu />
      <EditMenu />
      <DisplayMenu />
      <HelpMenu />
      <MenuPrimitive.Separator className={cn(separatorDefaultStyle, 'h-[1px] w-3 rotate-90 bg-brand-light')} />
      <RecentMenu />
    </MenuPrimitive.Root>
  )
}
