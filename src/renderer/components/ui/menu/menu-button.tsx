import { ComponentProps, ElementType, ReactNode } from 'react'
import { cn } from '~/utils'

type IMenuButtonProps = ComponentProps<'button'> & {
	Icon?: ElementType
	cnForIcon?: string
	label: string
	ghosted?: boolean
}

const GhostedClasses =
	'bg-transparent focus:bg-transparent text-neutral-1000 hover:text-brand hover:bg-transparent dark:text-white justify-start hover:opacity-90 font-medium'

const Button = (props: IMenuButtonProps) => {
	const { cnForIcon, ghosted, Icon, label, className, ...res } = props
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
			{Icon && <Icon className={cn(cnForIcon)} />}
			<span>{label}</span>
		</button>
	)
}

export default Button
