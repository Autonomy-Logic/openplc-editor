import { PlusIcon } from '@process:renderer/assets'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@utils/cn'
import { useRef, useState } from 'react'

export const NavigationPanelTabs = () => {
  const { updateEditor } = useOpenPLCStore()
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

  const handleClickedTab = (tab: { id: number; name: string }) => {
    setSelectedTab(tab.id)
    updateEditor({ path: tab.name, value: tab.name })
  }
  return (
    <nav className='isolate flex border-none outline-none' aria-label='Tabs'>
      {tabs.map((tab, index) => (
        <a
          draggable
          onDragStart={() => {
            dragTab.current = index
            setSelectedTab(tab.id)
          }}
          onDragEnter={() => (draggedOverTab.current = index)}
          onDragEnd={() => handleSort()}
          onDragOver={(e) => e.preventDefault()}
          key={tab.id}
          href={tab.href}
          onClick={() => handleClickedTab(tab)}
          className={cn(
            selectedTab === tab.id ? '' : 'border-r border-neutral-300 opacity-[35%]',
            'aria-[current=page]:dark:bg-brand-dark',
            'group relative flex h-[30px] min-w-0  max-w-[160px] flex-1 items-center justify-between overflow-hidden bg-neutral-100 px-3 py-2 text-start font-display text-xs font-normal text-neutral-1000 dark:bg-neutral-800 dark:text-white',
          )}
          aria-current={selectedTab === tab.id ? 'page' : undefined}
        >
          <span>{tab.name}</span>
          <PlusIcon
            onClick={() => handleDeleteTab(index)}
            className={`${
              selectedTab === tab.id ? 'inline' : 'hidden group-hover:inline'
            } h-4 w-4 rotate-45 stroke-brand dark:stroke-brand-light`}
          />
          <span
            aria-hidden='true'
            className={cn(
              selectedTab === tab.id ? 'bg-brand' : 'bg-transparent',
              'absolute inset-x-0 top-0 z-50 h-[3px]',
            )}
          />
        </a>
      ))}
    </nav>
  )
}
