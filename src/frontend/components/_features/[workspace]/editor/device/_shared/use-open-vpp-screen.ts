import { useCallback } from 'react'

import { useOpenPLCStore } from '../../../../../../store'
import { CreateEditorObjectFromTab } from '../../../../../../store/slices/tabs/utils'

/** Returns a callback that opens a board package's vendor screen in its tab and selects it. */
export function useOpenVppScreen(): (screenName: string) => void {
  const updateTabs = useOpenPLCStore((s) => s.tabsActions.updateTabs)
  const addModel = useOpenPLCStore((s) => s.editorActions.addModel)
  const setEditor = useOpenPLCStore((s) => s.editorActions.setEditor)
  const getEditorFromEditors = useOpenPLCStore((s) => s.editorActions.getEditorFromEditors)
  const setSelectedTab = useOpenPLCStore((s) => s.tabsActions.setSelectedTab)

  return useCallback(
    (screenName: string) => {
      const tab = {
        name: screenName,
        path: `/vendor-screen/${screenName}`,
        elementType: { type: 'vendor-screen' as const, screenName },
      }
      updateTabs(tab)
      const model = getEditorFromEditors(screenName) ?? CreateEditorObjectFromTab(tab)
      addModel(model)
      setEditor(model)
      setSelectedTab(screenName)
    },
    [updateTabs, getEditorFromEditors, addModel, setEditor, setSelectedTab],
  )
}
