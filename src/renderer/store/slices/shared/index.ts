import { StateCreator } from 'zustand'

import { IEditorSlice } from '../editor-slice'
import { ITabsSlice } from '../tabs-slice'
import { IWorkspaceSlice } from '../workspace-slice'
import { CreateEditorObject, CreatePouObject, CreateTabObject } from './utils'

type IDataToCreatePou = {
  name: string
  type: 'program' | 'function' | 'function-block'
  language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd'
}
export type ISharedSlice = {
  pouActions: {
    create: (dataToCreatePou: IDataToCreatePou) => boolean
    update: () => void
    delete: () => void
  }
}

export const createSharedSlice: StateCreator<IEditorSlice & ITabsSlice & IWorkspaceSlice, [], [], ISharedSlice> = (
  _setState,
  getState,
) => ({
  pouActions: {
    create: (dataToCreatePou: IDataToCreatePou) => {
      try {
        const res = getState().workspaceActions.createPou(CreatePouObject(dataToCreatePou))
        if (!res.ok) throw new Error()
        getState().editorActions.setEditor(CreateEditorObject(dataToCreatePou))
        getState().tabsActions.updateTabs(CreateTabObject(dataToCreatePou))
        return true
      } catch (_error) {
        return false
      }
    },
    update: () => {},
    delete: () => {},
  },
})

export type ISharedSliceToCreate = typeof createSharedSlice
