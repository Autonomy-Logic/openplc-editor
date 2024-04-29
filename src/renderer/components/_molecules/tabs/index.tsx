import { ITabProps } from '@process:renderer/store/slices/tabs-slice'
import { useOpenPLCStore } from '@root/renderer/store'
import { useRef, useState } from 'react'

import { Tab, TabList } from '../../_atoms'

const Tabs = () => {
  const {
    tabsState: { tabs },
    tabsActions: { sortTabs, removeTab },
  } = useOpenPLCStore()
  const [selectedTab, setSelectedTab] = useState('')
  const hasTabs = tabs.length > 0
  const dndTab = useRef<number>(0)
  const replaceTab = useRef<number>(0)
  const handleSort = () => {
    const tabClone = [...tabs]
    const draggedTab = tabClone[dndTab.current]
    tabClone.splice(dndTab.current, 1)
    tabClone.splice(replaceTab.current, 0, draggedTab)
    sortTabs(tabClone)
  }
  /**
   * Todo: this tab handler should be refactored to fit all possibles cases
   * @param tab the selected tab
   */
  const handleClickedTab = (tab: ITabProps) => {
    setSelectedTab(tab.name)
  }

  const handleDragStart = ({ tab, idx }: { tab: ITabProps; idx: number }) => {
    dndTab.current = idx
    setSelectedTab(tab.name)
  }
  const handleDragEnter = (idx: number) => {
    replaceTab.current = idx
  }
  return (
    <TabList>
      {hasTabs &&
        tabs.map((pou, idx) => (
          <Tab
            onDragStart={() => handleDragStart({ tab: pou, idx })}
            onDragEnter={() => handleDragEnter(idx)}
            onDragEnd={() => handleSort()}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => handleClickedTab(pou)}
            handleDeleteTab={() => removeTab(pou.name)}
            key={pou.name}
            fileName={pou.name}
            fileLang={pou.language}
            currentTab={selectedTab === pou.name}
          />
        ))}
    </TabList>
  )
}
export { Tabs }
