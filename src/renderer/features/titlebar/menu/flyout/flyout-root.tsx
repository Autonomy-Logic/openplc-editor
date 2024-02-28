import * as Popover from '@radix-ui/react-popover'
import { ComponentProps, ReactNode } from 'react'

type IFlyoutMenuRootProps = ComponentProps<typeof Popover.Root> & {
	label: string
	children: ReactNode
}

export const FlyoutMenuRoot = (props: IFlyoutMenuRootProps) => {
	const { label, children } = props
	return (
		<Popover.Root>
			<Popover.Trigger
				onClick={() => console.log('File clicked')}
				className='w-fit h-fit px-2 py-px text-white font-caption font-light text-xs rounded-sm bg-brand-dark dark:bg-neutral-950  hover:bg-brand-medium-dark hover:shadow-2xl hover:dark:bg-neutral-900 transition-colors'
			>
				{label}
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Content align='start' sideOffset={3} asChild>
					<div className='w-80 px-4 py-4 gap-2 bg-white dark:bg-neutral-900 dark:border-brand-dark rounded-md shadow-inner backdrop-blur-2xl border border-brand-light'>
						{children}
					</div>
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	)
}
