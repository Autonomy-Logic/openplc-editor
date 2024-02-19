import { PlusIcon } from '~/renderer/assets'
import { cn } from '~/utils'

const tabs = [
	{ name: 'My Account', href: '#', current: true },
	{ name: 'Company', href: '#', current: false },
	{ name: 'Team Members', href: '#', current: false },
	{ name: 'Billing', href: '#', current: false },
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
							: 'opacity-[35%] border-r-2 border-neutral-300',
						tabIdx === 0 ? 'rounded-tl-lg' : '',
						'group relative min-w-0 max-w-[160px] bg-neutral-100 h-1/2 flex-1 flex items-center justify-between overflow-hidden text-neutral-1000  py-2 px-3 text-start text-sm font-normal font-display'
					)}
					aria-current={tab.current ? 'page' : undefined}
				>
					<span>{tab.name}</span>
					<PlusIcon className='rotate-45 inline stroke-brand w-4 h-4' />
				</a>
			))}
		</nav>
	)
}
