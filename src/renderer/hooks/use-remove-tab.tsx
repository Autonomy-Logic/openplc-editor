import type { TabsProps } from '@process:renderer/store/slices'
import { useOpenPLCStore } from '@root/renderer/store'
import { CreateEditorObjectFromTab } from '@root/renderer/store/slices/tabs/utils'
import { useState } from 'react'

const useHandleRemoveTab = () => {
  const {
    tabs,
    editorActions: { setEditor, getEditorFromEditors, removeModel },
    tabsActions: { sortTabs },
  } = useOpenPLCStore()
  const [selectedTab, setSelectedTab] = useState('')

  const handleRemoveTab = (tabToRemove: string) => {
    const updatedTabs = tabs.filter((tab: TabsProps) => tab.name !== tabToRemove)
    removeModel(tabToRemove)

    const nextTab = updatedTabs[updatedTabs.length - 1]
    if (!nextTab) {
      setEditor({ type: 'available', meta: { name: '' } })
      sortTabs(updatedTabs)
      return
    }

    setSelectedTab(nextTab.name)

    const editor = getEditorFromEditors(nextTab.name)
    setEditor(editor || CreateEditorObjectFromTab(nextTab))
    sortTabs(updatedTabs)
  }

  return { handleRemoveTab, selectedTab, setSelectedTab }
}

export { useHandleRemoveTab }
