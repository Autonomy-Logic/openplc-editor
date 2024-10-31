/* eslint-disable @typescript-eslint/no-unsafe-call */
import { PLCArrayDatatype } from '@root/types/PLC/open-plc'
import { StateCreator } from 'zustand'

import { EditorSlice } from '../editor'
import { ProjectSlice } from '../project'
import { TabsSlice } from '../tabs'
import { CreateEditorObject, CreatePouObject } from './utils'

type PropsToCreatePou = {
  name: string
  type: 'program' | 'function' | 'function-block'
  language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd'
}

export type SharedSlice = {
  pouActions: {
    create: (propsToCreatePou: PropsToCreatePou) => boolean
    update: () => void
    delete: () => void
  }
  datatypeActions: {
    create: (propsToCreateDatatype: PLCArrayDatatype) => boolean
    update: () => void
    delete: () => void
  }
}

export const createSharedSlice: StateCreator<EditorSlice & TabsSlice & ProjectSlice, [], [], SharedSlice> = (
  _setState,
  getState,
) => ({
  pouActions: {
    create: (propsToCreatePou: PropsToCreatePou) => {
        if (propsToCreatePou.language === 'il' || propsToCreatePou.language === 'st') {
          const res = getState().projectActions.createPou(CreatePouObject(propsToCreatePou))
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
          const res = getState().projectActions.createPou(CreatePouObject(propsToCreatePou))
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
            graphical:
              propsToCreatePou.language === 'ld'
                ? { language: propsToCreatePou.language, openedRungs: [] }
                : { language: propsToCreatePou.language },
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
    update: () => {},
    delete: () => {},
  },
  datatypeActions: {
    create: (propsToCreateDatatype: PLCArrayDatatype) => {
      getState().projectActions.createDatatype(propsToCreateDatatype)
      getState().editorActions.addModel({type: 'plc-datatype', meta: {name: propsToCreateDatatype.name, derivation: propsToCreateDatatype.derivation}})
      getState().editorActions.setEditor({type: 'plc-datatype', meta: {name: propsToCreateDatatype.name, derivation: propsToCreateDatatype.derivation}})
      getState().tabsActions.updateTabs({name: propsToCreateDatatype.name, elementType: {type: 'data-type', derivation: propsToCreateDatatype.derivation}})

      return true
  },
  update: () => {},
  delete: () => {},
}})

export type SharedSliceToCreate = typeof createSharedSlice
