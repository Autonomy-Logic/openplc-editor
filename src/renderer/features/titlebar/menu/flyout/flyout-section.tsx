import { ComponentProps } from 'react'
import { cn } from '~/utils'

type IMenuSectionProps = ComponentProps<'ul'> & {
	section: IMenuItem[]
	hasSibling: boolean
}

type IMenuItem = ComponentProps<'li'> & {
	id: string
	label: string
	action?: () => void
	accelerator?: string
}

export const FlyoutMenuSection = (props: IMenuSectionProps) => {
	const { section, hasSibling, ...res } = props
	return (
		<ul
			className={cn(
				'w-full flex flex-col gap-2',
				`${hasSibling && 'border-b border-b-neutral-400 mb-2 pb-2'}`
			)}
			{...res}
		>
			{section?.map((item) => (
				// biome-ignore lint/a11y/useKeyWithClickEvents: This is not useful in this context
				<li
					key={item.label}
					className='px-2 py-1 text-neutral-850 font-normal font-caption text-xs dark:text-white flex items-center justify-between hover:bg-neutral-100 hover:dark:bg-neutral-700 rounded-sm cursor-pointer'
					onClick={item.action}
				>
					<span>{item.label}</span>
					<span className='opacity-40'>{item.accelerator}</span>
				</li>
			))}
		</ul>
	)
}
