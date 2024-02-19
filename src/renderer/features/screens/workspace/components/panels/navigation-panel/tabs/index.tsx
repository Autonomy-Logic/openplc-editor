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
						tab.current
							? 'border-b-[3px] border-brand'
							: 'opacity-[35%] border-r-2 border-neutral-300 dark:bg-neutral-900 dark:border-neutral-800',
						tabIdx === 0 ? 'rounded-tl-lg' : '',
						'group min-w-0 max-w-[160px] bg-neutral-100 h-1/2 flex-1 flex items-center justify-between overflow-hidden text-neutral-1000 dark:text-white  py-2 px-3 text-start text-sm font-normal font-display dark:bg-brand-dark'
					)}
					aria-current={tab.current ? 'page' : undefined}
				>
					<LDIcon />
					<span className='w-3/4 h-fit ml-1 truncate'>{tab.name}</span>
					<PlusIcon className='rotate-45 inline stroke-brand dark:stroke-brand-light w-4 h-4' />
				</a>
			))}
		</nav>
	)
}
