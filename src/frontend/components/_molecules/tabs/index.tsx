import { useEffect, useRef } from 'react'

import { useHandleRemoveTab } from '../../../hooks/use-remove-tab'
import { useOpenPLCStore } from '../../../store'
import type { TabsProps } from '../../../store/slices/tabs'
import { CreateEditorObjectFromTab } from '../../../store/slices/tabs/utils'
import { Tab } from '../../_atoms/tab'
import { TabList } from '../../_atoms/tab-list'

const Tabs = () => {
  const {
    tabs,
    editor,
    tabsActions: { sortTabs },
    editorActions: { setEditor, getEditorFromEditors },
  } = useOpenPLCStore()
  const { handleRemoveTab, selectedTab, setSelectedTab } = useHandleRemoveTab()
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
    const candidate = getEditorFromEditors(tab.name)
    if (!candidate) {
      setEditor(CreateEditorObjectFromTab(tab))
      return
    }
    setEditor(candidate)
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
  }, [editor.meta.name, setSelectedTab])

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
