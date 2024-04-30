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
    create: (dataToCreatePou: IDataToCreatePou) => void
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
      getState().editorActions.setEditor(CreateEditorObject(dataToCreatePou))
      getState().tabsActions.updateTabs(
        CreateTabObject({ name: dataToCreatePou.name, language: dataToCreatePou.language }),
      )
      getState().workspaceActions.createPou(CreatePouObject(dataToCreatePou))
    },
    update: () => {},
    delete: () => {},
  },
})
