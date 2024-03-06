import { ComponentProps, ReactNode } from 'react'
import { cn } from '~/utils'

type IMenuButtonProps = ComponentProps<'button'> & {
	children: ReactNode
}

export const MenuButton = (props: IMenuButtonProps) => {
	const { children, className, ...res } = props
	return (
		<button
			type='button'
			className={cn(
				'w-fit h-fit px-2 py-px text-white font-caption font-light text-xs rounded-sm bg-brand-dark hover:bg-brand-medium-dark dark:bg-neutral-950 hover:shadow-2xl hover:dark:bg-neutral-900 transition-colors',
				className
			)}
			{...res}
		>
			{children}
		</button>
	)
}
