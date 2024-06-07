import { StateCreator } from 'zustand'

import { EditorSlice } from '../editor'
import { TabsSlice } from '../tabs'
import { IWorkspaceSlice } from '../workspace-slice'
import { CreateDatatypeObject, CreateEditorObject, CreatePouObject } from './utils'

type PropsToCreatePou = {
  name: string
  type: 'program' | 'function' | 'function-block'
  language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd'
}

type _PropsToCreateDataType = {
  name: string
}
export type ISharedSlice = {
  pouActions: {
    create: {
      pou: (propsToCreatePou: PropsToCreatePou) => boolean
      dataType: (derivation: 'enumerated' | 'structure' | 'array') => boolean
    }
    update: () => void
    delete: () => void
  }
}

export const createSharedSlice: StateCreator<EditorSlice & TabsSlice & IWorkspaceSlice, [], [], ISharedSlice> = (
  _setState,
  getState,
) => ({
  pouActions: {
    create: {
      pou: (propsToCreatePou: PropsToCreatePou) => {
        if (propsToCreatePou.language === 'il' || propsToCreatePou.language === 'st') {
          const res = getState().workspaceActions.createPou(CreatePouObject(propsToCreatePou))
          if (!res.ok) throw new Error()
          const data = CreateEditorObject({
            type: 'plc-textual',
            name: propsToCreatePou.name,
            language: propsToCreatePou.language,
            derivation: propsToCreatePou.type,
          })
          getState().editorActions.setEditor({ editor: data })
          getState().tabsActions.updateTabs({
            name: propsToCreatePou.name,
            elementType: {
              type: propsToCreatePou.type,
              language: propsToCreatePou.language,
            },
          })
          return true
        }

        if (
          propsToCreatePou.language === 'ld' ||
          propsToCreatePou.language === 'sfc' ||
          propsToCreatePou.language === 'fbd'
        ) {
          const res = getState().workspaceActions.createPou(CreatePouObject(propsToCreatePou))
          if (!res.ok) throw new Error()
          const data = CreateEditorObject({
            type: 'plc-graphical',
            name: propsToCreatePou.name,
            language: propsToCreatePou.language,
            derivation: propsToCreatePou.type,
          })
          getState().editorActions.setEditor({ editor: data })
          getState().tabsActions.updateTabs({
            name: propsToCreatePou.name,
            elementType: {
              type: propsToCreatePou.type,
              language: propsToCreatePou.language,
            },
          })
          return true
        }
        return false
      },
      dataType: (derivation: 'enumerated' | 'structure' | 'array') => {
        getState().workspaceActions.createDatatype(CreateDatatypeObject(derivation))
        const data = CreateEditorObject({
          type: 'plc-datatype',
          derivation,
        })
        getState().editorActions.setEditor({ editor: data })
        // getState().tabsActions.updateTabs(CreateTabObject({ name: derivation, type: 'program', language: 'il' }))
        return true
      },
    },
    update: () => {},
    delete: () => {},
  },
})

export type ISharedSliceToCreate = typeof createSharedSlice
