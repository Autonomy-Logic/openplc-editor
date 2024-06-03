import { ITabProps } from '@process:renderer/store/slices/tabs-slice'
import { useOpenPLCStore } from '@root/renderer/store'
// import { CreateEditorObject } from '@root/renderer/store/slices/shared/utils'
import { useEffect, useRef, useState } from 'react'

import { Tab, TabList } from '../../_atoms'

const Tabs = () => {
  const {
    tabs,
    editor,
    tabsActions: { sortTabs },
    // editorActions: { setEditor },
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
  const handleClickedTab = (tab: ITabProps) => {
    if (tab.name === selectedTab) return
    setSelectedTab(tab.name)
    // setEditor(CreateEditorObject(tab))
  }

  const handleRemoveTab = (tabToRemove: string) => {
    const draftTabs = tabs.filter((t: ITabProps) => t.name !== tabToRemove)
    const candidate = draftTabs.slice(-1)[0]
    if (!candidate) {
      sortTabs(draftTabs)
      // setEditor({
      //   name: '',
      //   language: 'openplc',
      //   path: '',
      // })
    } else {
      setSelectedTab(candidate.name)
      // setEditor(CreateEditorObject(candidate))
      sortTabs(draftTabs)
    }
  }

  const handleDragStart = ({ tab, idx }: { tab: ITabProps; idx: number }) => {
    dndTab.current = idx
    setSelectedTab(tab.name)
    // setEditor(CreateEditorObject(tab))
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
        tabs.map((pou, idx) => (
          <Tab
            onDragStart={() => handleDragStart({ tab: pou, idx })}
            onDragEnter={() => handleDragEnter(idx)}
            onDragEnd={() => handleSort()}
            onDragOver={(e) => e.preventDefault()}
            handleClickedTab={() => handleClickedTab(pou)}
            handleDeleteTab={() => handleRemoveTab(pou.name)}
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
