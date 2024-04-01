import { cn } from '@root/utils'
import { ComponentPropsWithoutRef } from 'react'
import { Button } from '@components/_atoms'

type IMenuRootProps = ComponentPropsWithoutRef<'div'>
const MenuRoot = (props: IMenuRootProps) => {
	const { children, ...res } = props
	return (
		<div
			className='flex flex-col h-fit min-h-[372px] w-[240px] max-w-[240px] bg-transparent justify-start text-xl text-neutral-1000 dark:text-white'
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
	<hr className='stroke-neutral-200 stroke-[1.5px] w-48 my-4' {...props} />
)

type IMenuItemProps = ComponentPropsWithoutRef<typeof Button>
const MenuItem = (props: IMenuItemProps) => <Button {...props} />

export { MenuRoot, MenuSection, MenuDivider, MenuItem }
