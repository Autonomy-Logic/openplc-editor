import type { TabsProps } from '@process:renderer/store/slices'
import { useOpenPLCStore } from '@root/renderer/store'
import { useRef } from 'react'

import { Tab, TabList } from '../../_atoms'

const Tabs = () => {
  const {
    tabs,
    selectedTab,
    tabsActions: { sortTabs },
    sharedWorkspaceActions: { closeFile, openFile },
  } = useOpenPLCStore()
  const hasTabs = tabs.length > 0
  const dndTab = useRef<number>(0)
  const replaceTab = useRef<number>(0)

  const handleRemoveTab = (tabName: string | null) => {
    if (!tabName) return
    closeFile(tabName)
  }

  /**
   * Todo: this tab handler should be refactored to fit all possibles cases
   * @param tab the selected tab
   */
  const handleClickedTab = (tab: TabsProps) => {
    if (tab.name === selectedTab) return
    openFile(tab)
  }

  const handleSortOnDragEnd = () => {
    const tabClone = [...tabs]
    const draggedTab = tabClone[dndTab.current]
    tabClone.splice(dndTab.current, 1)
    tabClone.splice(replaceTab.current, 0, draggedTab)
    sortTabs(tabClone)
  }
  const handleDragStart = ({ tab, idx }: { tab: TabsProps; idx: number }) => {
    dndTab.current = idx
    openFile(tab)
  }
  const handleDragEnter = (idx: number) => {
    replaceTab.current = idx
  }

  return (
    <TabList>
      {hasTabs &&
        tabs.map((element, idx) => (
          <Tab
            onDragStart={() => handleDragStart({ tab: element, idx })}
            onDragEnter={() => handleDragEnter(idx)}
            onDragEnd={() => handleSortOnDragEnd()}
            onDragOver={(e) => e.preventDefault()}
            handleClickedTab={() => handleClickedTab(element)}
            handleDeleteTab={() => handleRemoveTab(element.name)}
            key={element.name}
            fileName={element.name}
            fileDerivation={element.elementType}
            currentTab={selectedTab === element.name}
          />
        ))}
    </TabList>
  )
}
export { Tabs }
