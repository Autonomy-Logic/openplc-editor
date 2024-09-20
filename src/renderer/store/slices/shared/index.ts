import { StateCreator } from 'zustand'

import { EditorSlice } from '../editor'
import { TabsSlice } from '../tabs'
import { WorkspaceSlice } from '../workspace'
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
      dataType: (name: string, derivation: 'enumerated' | 'structure' | 'array') => boolean
    }
    update: () => void
    delete: () => void
  }
}

export const createSharedSlice: StateCreator<EditorSlice & TabsSlice & WorkspaceSlice, [], [], ISharedSlice> = (
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
            meta: {
              name: propsToCreatePou.name,
              language: propsToCreatePou.language,
              path: `/data/pous/${propsToCreatePou.type}/${propsToCreatePou.name}`,
              pouType: propsToCreatePou.type,
            },
            variable: {
              display: 'table',
              description: '',
              classFilter: 'All',
              selectedRow: '-1',
            },
          })
          getState().editorActions.addModel(data)
          getState().editorActions.setEditor(data)
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
            meta: {
              name: propsToCreatePou.name,
              language: propsToCreatePou.language,
              path: `/data/pous/${propsToCreatePou.type}/${propsToCreatePou.name}`,
              pouType: propsToCreatePou.type,
            },
            variable: {
              display: 'table',
              description: '',
              classFilter: 'All',
              selectedRow: '-1',
            },
          })
          getState().editorActions.addModel(data)
          getState().editorActions.setEditor(data)
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
      dataType: (name: string, derivation:  'array' | 'enumerated' | 'structure') => {
        /**
         * This is a temporary solution to create a datatype
         **/
        getState().workspaceActions.createDatatype(CreateDatatypeObject({name, derivation}))
        const data = CreateEditorObject({
          type: 'plc-datatype',
          meta: { name: '', derivation },
        })
        getState().editorActions.addModel(data)
        getState().editorActions.setEditor(data)
        // getState().tabsActions.updateTabs(CreateTabObject({ name: derivation, type: 'program', language: 'il' }))
        return true
      },
    },
    update: () => {},
    delete: () => {},
  },
})

export type ISharedSliceToCreate = typeof createSharedSlice
