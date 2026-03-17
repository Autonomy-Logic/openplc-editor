import { Button } from '@components/_atoms'
import { cn } from '@root/utils'
import { ComponentPropsWithoutRef } from 'react'

type IMenuRootProps = ComponentPropsWithoutRef<'div'>
const MenuRoot = (props: IMenuRootProps) => {
  const { children, ...res } = props
  return (
    <div
      className='flex h-fit min-h-[372px] w-[240px] max-w-[240px] select-none flex-col justify-start bg-transparent text-xl text-neutral-1000 dark:text-white'
      {...res}
    >
      {children}
    </div>
  )
}

type IMenuSectionProps = ComponentPropsWithoutRef<'div'>
const MenuSection = (props: IMenuSectionProps) => {
  const { children, className, ...res } = props
  return (
    <div className={cn('flex flex-col gap-2', className)} {...res}>
      {children}
    </div>
  )
}

type IMenuDividerProps = ComponentPropsWithoutRef<'hr'>
const MenuDivider = (props: IMenuDividerProps) => (
  <hr className='my-4 w-48 stroke-neutral-200 stroke-[1.5px]' {...props} />
)

type IMenuItemProps = ComponentPropsWithoutRef<typeof Button>
const MenuItem = (props: IMenuItemProps) => <Button {...props} />

export { MenuDivider, MenuItem, MenuRoot, MenuSection }
