import type { TabsProps } from '@process:renderer/store/slices'
import { useOpenPLCStore } from '@root/renderer/store'
import { CreateEditorObjectFromTab } from '@root/renderer/store/slices/tabs/utils'
// import { CreateEditorObject } from '@root/renderer/store/slices/shared/utils'
import { useEffect, useRef, useState } from 'react'

import { Tab, TabList } from '../../_atoms'

const Tabs = () => {
  const {
    tabs,
    editor,
    tabsActions: { sortTabs },
    editorActions: { setEditor },
  } = useOpenPLCStore()
  const [selectedTab, setSelectedTab] = useState(editor.meta.name)
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
  const handleClickedTab = (tab: TabsProps) => {
    if (tab.name === selectedTab) return
    setSelectedTab(tab.name)
    setEditor(CreateEditorObjectFromTab(tab))
  }

  const handleRemoveTab = (tabToRemove: string) => {
    const draftTabs = tabs.filter((t: TabsProps) => t.name !== tabToRemove)
    const candidate = draftTabs.slice(-1)[0]
    if (!candidate) {
      sortTabs(draftTabs)
      setEditor({type: 'available', meta: { name: '' }})
    } else {
      setSelectedTab(candidate.name)
      setEditor(CreateEditorObjectFromTab(candidate))
      sortTabs(draftTabs)
    }
  }

  const handleDragStart = ({ tab, idx }: { tab: TabsProps; idx: number }) => {
    dndTab.current = idx
    setSelectedTab(tab.name)
    setEditor(CreateEditorObjectFromTab(tab))
  }
  const handleDragEnter = (idx: number) => {
    replaceTab.current = idx
  }

  useEffect(() => {
    setSelectedTab(editor.meta.name)
  }, [editor.meta.name])

  return (
    <TabList>
      {hasTabs &&
        tabs.map((element, idx) => (
          <Tab
            onDragStart={() => handleDragStart({ tab: element, idx })}
            onDragEnter={() => handleDragEnter(idx)}
            onDragEnd={() => handleSort()}
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
