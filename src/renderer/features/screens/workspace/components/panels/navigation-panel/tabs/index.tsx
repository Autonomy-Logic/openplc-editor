import { useRef, useState } from 'react'
import { LDIcon, PlusIcon } from '~/renderer/assets'
import { cn } from '~/utils'

const tabs = [
	{ name: 'Program', href: '#', current: true },
	{ name: 'Function', href: '#', current: false },
	{ name: 'Function Block', href: '#', current: false },
	{ name: 'Data Type', href: '#', current: false },
]
export const NavigationPanelTabs = () => {
	return (
		<nav className='isolate flex border-none' aria-label='Tabs'>
			{tabs.map((tab, tabIdx) => (
				<a
					key={tab.name}
					href={tab.href}
					className={cn(
						tab.current ? '' : 'opacity-[35%] border-r border-neutral-300',
						tabIdx === 0 ? 'rounded-tl-lg' : '',
						'group min-w-0 max-w-[160px] bg-neutral-100 h-1/2 flex-1 flex items-center justify-between overflow-hidden text-neutral-1000 dark:text-white  py-2 px-3 text-start text-sm font-normal font-display dark:bg-brand-dark'
					)}
					aria-current={tab.current ? 'page' : undefined}
				>
					<span>{tab.name}</span>
					<PlusIcon className='rotate-45 inline stroke-brand w-4 h-4' />
					<span
						aria-hidden='true'
						className={cn(
							tab.current ? 'bg-brand' : 'bg-transparent',
							'absolute inset-x-0 bottom-0 h-[3px]'
						)}
					/>
				</a>
			))}
		</nav>
	)
}
