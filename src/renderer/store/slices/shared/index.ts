/* eslint-disable @typescript-eslint/no-unsafe-call */
import { IProjectServiceResponse } from '@root/main/services'
import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import { PLCArrayDatatype, PLCEnumeratedDatatype, PLCStructureDatatype } from '@root/types/PLC/open-plc'
import { StateCreator } from 'zustand'

import { EditorSlice } from '../editor'
import { FlowSlice, FlowType } from '../flow'
import { LibrarySlice } from '../library'
import { ModalSlice } from '../modal'
import { ProjectSlice } from '../project'
import { TabsProps, TabsSlice } from '../tabs'
import { CreateEditorObjectFromTab } from '../tabs/utils'
import { WorkspaceSlice } from '../workspace'
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
    create: (propsToCreateDatatype: PLCArrayDatatype | PLCEnumeratedDatatype | PLCStructureDatatype) => boolean
    update: () => void
    delete: () => void
  }
  sharedWorkspaceActions: {
    clearStatesOnCloseProject: () => void
    closeProject: () => void
    handleOpenProjectRequest: (data: IProjectServiceResponse['data']) => void
    openProject: () => Promise<{
      success: boolean
      error?: { title: string; description: string }
    }>
    openProjectByPath: (projectPath: string) => Promise<{
      success: boolean
      error?: { title: string; description: string }
    }>
    openRecentProject: (response: IProjectServiceResponse) => {
      success: boolean
      error?: { title: string; description: string }
    }
  }
}

export const createSharedSlice: StateCreator<
  EditorSlice & TabsSlice & ProjectSlice & LibrarySlice & ModalSlice & FlowSlice & WorkspaceSlice & SharedSlice,
  [],
  [],
  SharedSlice
> = (_setState, getState) => ({
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
        propsToCreatePou.type !== 'program' &&
          getState().libraryActions.addLibrary(propsToCreatePou.name, propsToCreatePou.type)
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
        propsToCreatePou.type !== 'program' &&
          getState().libraryActions.addLibrary(propsToCreatePou.name, propsToCreatePou.type)
        return true
      }
      return false
    },
    update: () => {},
    delete: () => {},
  },
  datatypeActions: {
    create: (propsToCreateDatatype: PLCArrayDatatype | PLCEnumeratedDatatype | PLCStructureDatatype) => {
      getState().projectActions.createDatatype({ data: propsToCreateDatatype })
      getState().editorActions.addModel({
        type: 'plc-datatype',
        meta: { name: propsToCreateDatatype.name, derivation: propsToCreateDatatype.derivation },
        structure: {
          selectedRow: '-1',
          description: '',
        },
      })
      getState().editorActions.setEditor({
        type: 'plc-datatype',
        meta: { name: propsToCreateDatatype.name, derivation: propsToCreateDatatype.derivation },
        structure: {
          selectedRow: '-1',
          description: '',
        },
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

  sharedWorkspaceActions: {
    clearStatesOnCloseProject: () => {
      getState().editorActions.clearEditor()
      getState().tabsActions.clearTabs()
      getState().libraryActions.clearUserLibraries()
      getState().flowActions.clearFlows()
      getState().projectActions.clearProjects()
    },
    closeProject: () => {
      const editingState = getState().workspace.editingState
      if (editingState === 'unsaved') {
        getState().modalActions.openModal('save-changes-project', 'close-project')
        return
      }
      getState().sharedWorkspaceActions.clearStatesOnCloseProject()
      getState().workspaceActions.setEditingState('initial-state')
    },

    handleOpenProjectRequest(data) {
      if (data) {
        getState().sharedWorkspaceActions.clearStatesOnCloseProject()
        getState().workspaceActions.setEditingState('unsaved')
        const projectMeta = {
          name: data.content.meta.name,
          type: data.content.meta.type,
          path: data.meta.path,
        }
        const projectData = data.content.data

        getState().projectActions.setProject({
          data: projectData,
          meta: projectMeta,
        })

        const ladderPous = projectData.pous.filter((pou) => pou.data.language === 'ld')
        if (ladderPous.length)
          ladderPous.forEach((pou) => {
            if (pou.data.body.language === 'ld') getState().flowActions.addFlow(pou.data.body.value as FlowType)
          })

        projectData.pous.map(
          (pou) => pou.type !== 'program' && getState().libraryActions.addLibrary(pou.data.name, pou.type),
        )

        if (projectData.pous.length !== 0) {
          const mainPou = projectData.pous.find((pou) => pou.data.name === 'main' && pou.type === 'program')
          if (mainPou) {
            const tabToBeCreated: TabsProps = {
              name: mainPou.data.name,
              path: '/data/pous/program/main',
              elementType: { type: 'program', language: mainPou.data.language },
            }
            getState().tabsActions.updateTabs(tabToBeCreated)
            const model = CreateEditorObjectFromTab(tabToBeCreated)
            getState().editorActions.addModel(model)
            getState().editorActions.setEditor(model)
          }
        }

        toast({
          title: 'Project opened!',
          description: 'Your project was opened, and loaded.',
          variant: 'default',
        })
      }
    },
    openProject: async () => {
      const { success, data, error } = await window.bridge.openProject()
      if (success) {
        getState().sharedWorkspaceActions.handleOpenProjectRequest(data)
        return {
          success: success,
        }
      }

      toast({
        title: 'Cannot open the project.',
        description: error?.description,
        variant: 'fail',
      })
      return {
        success: false,
        error,
      }
    },
    openProjectByPath: async (projectPath: string) => {
      const { success, data, error } = await window.bridge.openProjectByPath(projectPath)
      if (success) {
        getState().sharedWorkspaceActions.handleOpenProjectRequest(data)
        return {
          success: success,
        }
      }

      toast({
        title: 'Cannot open the project.',
        description: error?.description,
        variant: 'fail',
      })
      return {
        success: false,
        error,
      }
    },
    openRecentProject: (response) => {
      const { data, error } = response
      if (data) {
        getState().sharedWorkspaceActions.handleOpenProjectRequest(data)
        return {
          success: true,
        }
      }

      toast({
        title: 'Cannot open the project.',
        description: error?.description,
        variant: 'fail',
      })
      return {
        success: false,
        error,
      }
    },
  },
})

export type SharedSliceToCreate = typeof createSharedSlice
