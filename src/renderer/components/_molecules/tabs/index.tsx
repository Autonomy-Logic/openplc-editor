import type { TabsProps } from '@process:renderer/store/slices'
import { useHandleRemoveTab } from '@root/renderer/hooks'
import { useOpenPLCStore } from '@root/renderer/store'
import { CreateEditorObjectFromTab } from '@root/renderer/store/slices/tabs/utils'
// import { CreateEditorObject } from '@root/renderer/store/slices/shared/utils'
import { useEffect, useRef } from 'react'

import { Tab, TabList } from '../../_atoms'

const Tabs = () => {
  const {
    tabs,
    editor,
    tabsActions: { sortTabs},
    projectActions: {
      deletePou
    },
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


  const handleDeletePou =(pouName: string) => {
    handleRemoveTab(pouName)
    deletePou(pouName)
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
  
  useEffect(() => {
    window.bridge.closeTabAccelerator((_event) => handleRemoveTab(selectedTab))
    window.bridge.deletePouAccelerator((_event) => handleDeletePou(selectedTab))
    return () => {
     void window.bridge.removeCloseTabListener(); 
     void window.bridge.removeDeletePouListener();
    };
  });

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
