/* eslint-disable @typescript-eslint/no-unsafe-call */
import { PLCArrayDatatype } from '@root/types/PLC/open-plc'
import { StateCreator } from 'zustand'

import { ConsoleSlice } from '../console'
import { EditorSlice } from '../editor'
<<<<<<< Updated upstream
=======
import { FlowSlice } from '../flow'
>>>>>>> Stashed changes
import { LibrarySlice } from '../library'
import { ProjectSlice } from '../project'
import { SearchSlice } from '../search'
import { TabsSlice } from '../tabs'
import { WorkspaceSlice } from '../workspace'
import { CreateEditorObject, CreatePouObject } from './utils'

type PropsToCreatePou = {
  name: string
  type: 'program' | 'function' | 'function-block'
  language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd'
}

export type SharedSlice = {
  flushStore: () => void
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

<<<<<<< Updated upstream
export const createSharedSlice: StateCreator<EditorSlice & TabsSlice & ProjectSlice & LibrarySlice, [], [], SharedSlice> = (
  _setState,
  getState,
) => ({
=======
export const createSharedSlice: StateCreator<
  EditorSlice & TabsSlice & ProjectSlice & ConsoleSlice & FlowSlice & LibrarySlice & WorkspaceSlice & SearchSlice,
  [],
  [],
  SharedSlice
> = (_setState, getState) => ({
  flushStore: () => {
    getState().consoleActions.clearLogs()
    getState().editorActions.clearEditor()
    getState().flowActions.clearFlow()
    getState().libraryActions.clearLibraries()
    getState().projectActions.clearProject()
    getState().searchActions.clearSearchResults()
    getState().tabsActions.clearTabs()
    getState().workspaceActions.clearWorkspace()
  },
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
        propsToCreatePou.type !== 'program' && getState().libraryActions.addLibrary(propsToCreatePou.name, propsToCreatePou.type)
=======
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
        propsToCreatePou.type !== 'program' && getState().libraryActions.addLibrary(propsToCreatePou.name, propsToCreatePou.type)
=======
>>>>>>> Stashed changes
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
      getState().editorActions.addModel({
        type: 'plc-datatype',
        meta: { name: propsToCreateDatatype.name, derivation: propsToCreateDatatype.derivation },
      })
      getState().editorActions.setEditor({
        type: 'plc-datatype',
        meta: { name: propsToCreateDatatype.name, derivation: propsToCreateDatatype.derivation },
      })
      getState().tabsActions.updateTabs({
        name: propsToCreateDatatype.name,
        elementType: { type: 'data-type', derivation: propsToCreateDatatype.derivation },
      })

      return true
    },
    update: () => {},
    delete: () => {},
  },
})

export type SharedSliceToCreate = typeof createSharedSlice
