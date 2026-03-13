import { useRef } from 'react'

import { useOpenPLCStore } from '../../../store'
import type { TabsProps } from '../../../store/slices/tabs'
import { Tab } from '../../_atoms/tab'
import { TabList } from '../../_atoms/tab-list'

const Tabs = () => {
  const {
    tabs,
    editor,
    tabsActions: { sortTabs, removeTab },
    editorActions: { setEditor, getEditorFromEditors },
    fileActions: { removeFile },
  } = useOpenPLCStore()

  const selectedTab = editor.meta.name
  const hasTabs = tabs.length > 0
  const dndTab = useRef<number>(0)
  const replaceTab = useRef<number>(0)

  const handleRemoveTab = (tabName: string | null) => {
    if (!tabName) return
    removeTab(tabName)
    removeFile({ name: tabName })
  }

  const handleClickedTab = (tab: TabsProps) => {
    if (tab.name === selectedTab) return
    const candidate = getEditorFromEditors(tab.name)
    if (candidate) {
      setEditor(candidate)
    }
  }

  const handleSortOnDragEnd = () => {
    const tabsClone = [...tabs]
    const draggedTab = tabsClone.splice(dndTab.current, 1)[0]
    tabsClone.splice(replaceTab.current, 0, draggedTab)
    sortTabs(tabsClone)
  }

  const handleDragStart = ({ tab, idx }: { tab: TabsProps; idx: number }) => {
    dndTab.current = idx
    handleClickedTab(tab)
  }

  const handleDragEnter = (idx: number) => {
    replaceTab.current = idx
  }

  return (
    <TabList>
      {hasTabs &&
        tabs.map((tab, idx) => (
          <Tab
            key={tab.name}
            tab={tab}
            onClick={() => handleClickedTab(tab)}
            onClose={() => handleRemoveTab(tab.name)}
            selected={selectedTab === tab.name}
            draggable
            onDragStart={() => handleDragStart({ tab, idx })}
            onDragEnter={() => handleDragEnter(idx)}
            onDragEnd={handleSortOnDragEnd}
            onDragOver={(e) => e.preventDefault()}
          />
        ))}
    </TabList>
  )
}

export { Tabs }
