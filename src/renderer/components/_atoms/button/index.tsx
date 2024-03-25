import { ComponentProps, ReactNode } from 'react'
import { cn } from '@utils/cn'

type IButtonProps = ComponentProps<'button'> & {
	ghosted?: boolean
	children?: ReactNode
}

const GhostedClasses =
	'bg-transparent focus:bg-transparent text-neutral-1000 hover:text-brand hover:bg-transparent dark:text-white justify-start hover:opacity-90 font-medium'

const Button = (props: IButtonProps) => {
	const { children, ghosted, className, ...res } = props
	return (
		<button
			type='button'
			className={cn(
				`w-48 h-12 bg-brand focus:bg-brand-medium text-white flex items-center rounded-md hover:bg-brand-medium-dark font-caption text-xl font-normal px-5 py-3 gap-3
				${ghosted ? GhostedClasses : ''}`,
				className
			)}
			{...res}
		>
			{children}
		</button>
	)
}

export { Button }
