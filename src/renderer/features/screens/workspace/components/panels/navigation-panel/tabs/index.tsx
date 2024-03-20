import { useState, useRef } from 'react'
import { LDIcon, PlusIcon } from '@process:renderer/assets'
import { cn } from '@utils/cn'

export const NavigationPanelTabs = () => {
	const [tabs, setTabs] = useState([
		{ id: 1, name: 'Program', href: '#' },
		{ id: 2, name: 'Function', href: '#' },
		{ id: 3, name: 'Function Block', href: '#' },
		{ id: 4, name: 'Data Type', href: '#' },
	])
	const [selectedTab, setSelectedTab] = useState(tabs[0].id)

	const dragTab = useRef<number>(0)
	const draggedOverTab = useRef<number>(0)

	const handleSort = () => {
		const tabClone = [...tabs]
		const draggedTab = tabClone[dragTab.current]
		tabClone.splice(dragTab.current, 1)
		tabClone.splice(draggedOverTab.current, 0, draggedTab)
		setTabs(tabClone)
	}

	const handleDeleteTab = (id: number) => {
		const tabClone = [...tabs]

		tabClone.splice(id, 1)
		setTabs(tabClone)
	}

	return (
		<nav className='isolate flex border-none outline-none' aria-label='Tabs'>
			{tabs.map((tab, index) => (
				<a
					draggable
					onDragStart={(e) => {
						dragTab.current = index
						setSelectedTab(tab.id)
					}}
					onDragEnter={(e) => (draggedOverTab.current = index)}
					onDragEnd={() => handleSort()}
					onDragOver={(e) => e.preventDefault()}
					key={tab.id}
					href={tab.href}
					onClick={() => setSelectedTab(tab.id)}
					className={cn(
						selectedTab === tab.id
							? ''
							: 'opacity-[35%] border-r border-neutral-300',
						'aria-[current=page]:dark:bg-brand-dark',
						'group min-w-0 max-w-[160px] relative bg-neutral-100 relative h-1/2 flex-1 flex items-center justify-between overflow-hidden text-neutral-1000 dark:text-white py-2 px-3 text-start text-sm font-normal font-display dark:bg-neutral-800'
					)}
					aria-current={selectedTab === tab.id ? 'page' : undefined}
				>
					<span>{tab.name}</span>
					<PlusIcon
						onClick={() => handleDeleteTab(index)}
						className={`${
							selectedTab === tab.id ? 'inline' : 'hidden group-hover:inline'
						} rotate-45 stroke-brand dark:stroke-brand-light w-4 h-4`}
					/>
					<span
						aria-hidden='true'
						className={cn(
							selectedTab === tab.id ? 'bg-brand' : 'bg-transparent',
							'absolute inset-x-0 top-0 h-[3px] z-50'
						)}
					/>
				</a>
			))}
		</nav>
	)
}
