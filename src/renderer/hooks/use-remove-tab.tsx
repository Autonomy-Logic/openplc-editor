import { useOpenPLCStore } from '@root/renderer/store'
import { CreateEditorObjectFromTab } from '@root/renderer/store/slices/tabs/utils'
import { useState } from 'react'

const useHandleRemoveTab = () => {
  const {
    editorActions: { setEditor, getEditorFromEditors },
    sharedWorkspaceActions: { closeFile },
  } = useOpenPLCStore()
  const [selectedTab, setSelectedTab] = useState('')

  const handleRemoveTab = (tabToRemove: string) => {
    const { tabs: updatedTabs } = closeFile(tabToRemove).data || { tabs: [] }

    const nextTab = updatedTabs[updatedTabs.length - 1]
    if (!nextTab) {
      setEditor({ type: 'available', meta: { name: '' } })
      setSelectedTab('')
      return
    }

    const editor = getEditorFromEditors(nextTab.name)
    const editorModel = editor || CreateEditorObjectFromTab(nextTab)
    setEditor(editorModel)
    setSelectedTab(nextTab.name)
  }

  return { handleRemoveTab, selectedTab, setSelectedTab }
}

export { useHandleRemoveTab }
