import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import { CreateProjectFileProps, IProjectServiceResponse } from '@root/types/IPC/project-service'
import { PLCVariable as VariablePLC } from '@root/types/PLC'
import {
  PLCArrayDatatype,
  PLCDataType,
  PLCEnumeratedDatatype,
  PLCStructureDatatype,
  PLCVariable,
} from '@root/types/PLC/open-plc'
import { StateCreator } from 'zustand'

import { DeviceSlice } from '../device'
import { EditorSlice } from '../editor'
import { FBDFlowSlice, FBDFlowType } from '../fbd'
import { HistorySlice, HistorySnapshot } from '../history'
import { LadderFlowSlice, LadderFlowType } from '../ladder'
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
    createProject: (dataToCreateProjectFile: CreateProjectFileProps) => Promise<{
      success: boolean
      error?: { title: string; description: string }
    }>
  }
  snapshotActions: {
    addSnapshot: (pouName: string) => void
    undo: (pouName: string) => void
    redo: (pouName: string) => void
  }
}

export const createSharedSlice: StateCreator<
  EditorSlice &
    TabsSlice &
    ProjectSlice &
    LibrarySlice &
    ModalSlice &
    FBDFlowSlice &
    LadderFlowSlice &
    WorkspaceSlice &
    DeviceSlice &
    HistorySlice &
    SharedSlice,
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
        if (propsToCreatePou.type !== 'program')
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
              : propsToCreatePou.language === 'fbd'
                ? {
                    language: propsToCreatePou.language,
                    hoveringElement: {
                      elementId: null,
                      hovering: false,
                    },
                    canEditorZoom: true,
                    canEditorPan: true,
                  }
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
        if (propsToCreatePou.language === 'fbd') {
          getState().fbdFlowActions.addFBDFlow({
            name: propsToCreatePou.name,
            updated: true,
            rung: {
              comment: '',
              nodes: [],
              edges: [],
              selectedNodes: [],
            },
          })
        }
        if (propsToCreatePou.language === 'ld') {
          getState().ladderFlowActions.addLadderFlow({
            name: propsToCreatePou.name,
            updated: true,
            rungs: [],
          })
        }
        if (propsToCreatePou.type !== 'program') {
          getState().libraryActions.addLibrary(propsToCreatePou.name, propsToCreatePou.type)
        }
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
      getState().workspaceActions.setEditingState('initial-state')
      getState().editorActions.clearEditor()
      getState().tabsActions.clearTabs()
      getState().libraryActions.clearUserLibraries()
      getState().fbdFlowActions.clearFBDFlows()
      getState().ladderFlowActions.clearLadderFlows()
      getState().projectActions.clearProjects()
      getState().deviceActions.clearDeviceDefinitions()
      window.bridge.rebuildMenu()
    },

    closeProject: () => {
      const editingState = getState().workspace.editingState
      if (editingState === 'unsaved') {
        getState().modalActions.openModal('save-changes-project', {
          validationContext: 'close-project',
        })
        return
      }
      getState().sharedWorkspaceActions.clearStatesOnCloseProject()
    },

    handleOpenProjectRequest(data) {
      if (data) {
        getState().workspaceActions.setEditingState('unsaved')

        const { project, deviceConfiguration, devicePinMapping } = data.content

        const projectMeta = {
          name: project.meta.name,
          type: project.meta.type,
          path: data.meta.path,
        }
        const projectData = project.data

        getState().projectActions.setProject({
          data: projectData,
          meta: projectMeta,
        })

        const ladderPous = projectData.pous.filter((pou) => pou.data.language === 'ld')
        if (ladderPous.length)
          ladderPous.forEach((pou) => {
            if (pou.data.body.language === 'ld')
              getState().ladderFlowActions.addLadderFlow(pou.data.body.value as LadderFlowType)
          })

        const fbdPous = projectData.pous.filter((pou) => pou.data.language === 'fbd')
        if (fbdPous.length)
          fbdPous.forEach((pou) => {
            if (pou.data.body.language === 'fbd')
              getState().fbdFlowActions.addFBDFlow(pou.data.body.value as FBDFlowType)
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
            const model = CreateEditorObjectFromTab(tabToBeCreated)
            getState().tabsActions.updateTabs(tabToBeCreated)
            getState().editorActions.addModel(model)
            getState().editorActions.setEditor(model)
          }
        }

        getState().deviceActions.setDeviceDefinitions({
          configuration: deviceConfiguration,
          pinMapping: devicePinMapping,
        })

        toast({
          title: 'Project opened!',
          description: 'Your project was opened, and loaded.',
          variant: 'default',
        })
      }
    },
    openProject: async () => {
      getState().sharedWorkspaceActions.clearStatesOnCloseProject()
      const { success, data, error } = await window.bridge.openProject()

      if (success) {
        getState().sharedWorkspaceActions.handleOpenProjectRequest(data)
        return {
          success: success,
        }
      }

      if (error?.title === 'Operation canceled') {
        toast({
          title: 'Operation canceled',
          description: 'You have canceled the project opening operation.',
          variant: 'warn',
        })
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
    openProjectByPath: async (projectPath: string) => {
      getState().sharedWorkspaceActions.clearStatesOnCloseProject()
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
      getState().sharedWorkspaceActions.clearStatesOnCloseProject()
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

    createProject: async (dataToCreateProjectFile) => {
      const result = await window.bridge.createProject(dataToCreateProjectFile)

      if (!result.data) {
        toast({
          title: 'Cannot create a project!',
          description: 'Failed to create the project. No data returned.',
          variant: 'fail',
        })

        return {
          success: false,
          error: {
            title: 'Cannot create a project!',
            description: 'Failed to create the project. No data returned.',
          },
        }
      }

      getState().sharedWorkspaceActions.clearStatesOnCloseProject()
      getState().workspaceActions.setEditingState('unsaved')
      getState().projectActions.setProject({
        meta: {
          name: dataToCreateProjectFile.name,
          type: dataToCreateProjectFile.type,
          path: dataToCreateProjectFile.path + '/project.json',
        },
        data: result.data.content.project.data,
      })

      result.data.content.project.data.pous.forEach((pou) => {
        if (pou.data.language === 'fbd') {
          getState().fbdFlowActions.addFBDFlow({
            name: pou.data.name,
            updated: true,
            rung: {
              comment: '',
              nodes: [],
              edges: [],
              selectedNodes: [],
            },
          })
        }
        if (pou.data.language === 'ld') {
          getState().ladderFlowActions.addLadderFlow({
            name: pou.data.name,
            updated: true,
            rungs: [],
          })
        }
      })

      window.bridge.rebuildMenu()

      toast({
        title: 'The project was created successfully!',
        description: 'To begin using the OpenPLC Editor, add a new POU to your project.',
        variant: 'default',
      })

      return {
        success: true,
      }
    },
  },
  snapshotActions: {
    addSnapshot: (pouName) => {
      const ladderFlows = getState().ladderFlows
      const fbdFlows = getState().fbdFlows
      const resource = getState().project.data.configuration.resource
      const dataTypes = getState().project.data.dataTypes

      const { globalVariables, tasks, instances } = resource

      const pou = getState().project.data.pous.find((pou) => pou.data.name === pouName)
      const flow = ladderFlows.find((ladderFlow) => ladderFlow.name === pouName)
      const fbdFlow = fbdFlows.find((fbdFlow) => fbdFlow.name === pouName)

      const isDataType = dataTypes.some((dataType) => dataType.name === pouName)
      const isResource = pouName === 'resource'

      if (
        !isResource &&
        !isDataType &&
        !pou &&
        !flow &&
        !fbdFlow &&
        globalVariables.length === 0 &&
        tasks.length === 0 &&
        instances.length === 0
      ) {
        return
      }

      const snapshot: HistorySnapshot = {
        variables: [],
        body: undefined,
        ladderFlow: undefined,
        fbdFlow: undefined,
        globalVariables: [],
        tasks: [],
        instances: [],
        dataTypes: undefined,
      }

      if (pou) {
        snapshot.variables = JSON.parse(JSON.stringify(pou.data.variables)) as VariablePLC[]
        snapshot.body = JSON.parse(JSON.stringify(pou.data.body)) as unknown as string
      }

      if (flow) {
        snapshot.ladderFlow = JSON.parse(JSON.stringify(flow)) as HistorySnapshot['ladderFlow']
      }

      if (fbdFlow) {
        snapshot.fbdFlow = JSON.parse(JSON.stringify(fbdFlow)) as HistorySnapshot['fbdFlow']
      }

      if (globalVariables.length) {
        snapshot.globalVariables = JSON.parse(JSON.stringify(globalVariables)) as VariablePLC[]
      }

      if (tasks.length) {
        snapshot.tasks = JSON.parse(JSON.stringify(tasks)) as HistorySnapshot['tasks']
      }

      if (instances.length) {
        snapshot.instances = JSON.parse(JSON.stringify(instances)) as HistorySnapshot['instances']
      }

      if (getState().history[pouName]) {
        getState().history[pouName] = { past: [], future: [] }
      }

      if (isDataType) {
        const dataType = dataTypes.find((dataType) => dataType.name === pouName)!

        snapshot.dataTypes = JSON.parse(JSON.stringify(dataType)) as HistorySnapshot['dataTypes']
      }

      getState().historyActions.addPastHistory(pouName, snapshot)

      if (getState().history[pouName].past.length > 50) {
        getState().history[pouName].past.shift()
      }
    },
    undo: (pouName) => {
      const ladderFlows = getState().ladderFlows
      const fbdFlows = getState().fbdFlows
      const resource = getState().project.data.configuration.resource
      const dataTypes = getState().project.data.dataTypes

      const { globalVariables, tasks, instances } = resource

      const history = getState().history[pouName]

      if (!history || history.past.length === 0) {
        return
      }

      const isDataType = dataTypes.some((dataType) => dataType.name === pouName)
      const isResource = pouName === 'resource'

      const pou = isResource ? undefined : getState().project.data.pous.find((p) => p.data.name === pouName)

      const flowIndex = ladderFlows.findIndex((ladderFlow) => ladderFlow.name === pouName)
      const fbdIndex = fbdFlows.findIndex((fbdFlow) => fbdFlow.name === pouName)

      const currentSnapshot: HistorySnapshot = {
        variables: pou ? (JSON.parse(JSON.stringify(pou.data.variables)) as HistorySnapshot['variables']) : [],
        body: pou ? (JSON.parse(JSON.stringify(pou.data.body)) as unknown as string) : undefined,
        ladderFlow:
          flowIndex !== -1
            ? (JSON.parse(JSON.stringify(ladderFlows[flowIndex])) as HistorySnapshot['ladderFlow'])
            : undefined,
        fbdFlow:
          fbdIndex !== -1 ? (JSON.parse(JSON.stringify(fbdFlows[fbdIndex])) as HistorySnapshot['fbdFlow']) : undefined,
        globalVariables: globalVariables.length
          ? (JSON.parse(JSON.stringify(globalVariables)) as HistorySnapshot['globalVariables'])
          : [],
        tasks: tasks.length ? (JSON.parse(JSON.stringify(tasks)) as HistorySnapshot['tasks']) : [],
        instances: instances.length ? (JSON.parse(JSON.stringify(instances)) as HistorySnapshot['instances']) : [],
        dataTypes: isDataType
          ? (JSON.parse(JSON.stringify(dataTypes.find((dt) => dt.name === pouName))) as HistorySnapshot['dataTypes'])
          : undefined,
      }

      getState().historyActions.addFutureHistory(pouName, currentSnapshot)

      const previous = getState().historyActions.popPastHistory(pouName)

      if (!previous) {
        return
      }

      if (isResource) {
        const { setGlobalVariables, setTasks, setInstances } = getState().projectActions

        setGlobalVariables({ variables: (previous?.globalVariables ?? []) as PLCVariable[] })
        setTasks({ tasks: previous?.tasks ?? [] })
        setInstances({ instances: previous?.instances ?? [] })

        return
      }

      if (isDataType && previous.dataTypes) {
        const { applyDatatypeSnapshot } = getState().projectActions

        applyDatatypeSnapshot(pouName, previous.dataTypes as unknown as PLCDataType)

        return
      }

      if (!isResource && pou) {
        getState().projectActions.applyPouSnapshot(
          pouName,
          previous.variables as PLCVariable[],
          previous.body as typeof pou.data.body,
        )
      }

      getState().ladderFlowActions.applyLadderFlowSnapshot({
        editorName: pouName,
        snapshot: previous.ladderFlow as LadderFlowType | null,
      })

      getState().fbdFlowActions.applyFBDFlowSnapshot({
        editorName: pouName,
        snapshot: previous.fbdFlow as FBDFlowType | null,
      })
    },
    redo: (pouName) => {
      const ladderFlows = getState().ladderFlows
      const fbdFlows = getState().fbdFlows
      const resource = getState().project.data.configuration.resource
      const dataTypes = getState().project.data.dataTypes

      const { globalVariables, tasks, instances } = resource

      const history = getState().history[pouName]

      if (!history || history.future.length === 0) {
        return
      }

      const isDataType = dataTypes.some((dataType) => dataType.name === pouName)
      const isResource = pouName === 'resource'

      const pou = isResource ? undefined : getState().project.data.pous.find((p) => p.data.name === pouName)

      const flowIndex = ladderFlows.findIndex((ladderFlow) => ladderFlow.name === pouName)
      const fbdIndex = fbdFlows.findIndex((fbdFlow) => fbdFlow.name === pouName)

      const currentSnapshot: HistorySnapshot = {
        variables: pou ? (JSON.parse(JSON.stringify(pou.data.variables)) as HistorySnapshot['variables']) : [],
        body: pou ? (JSON.parse(JSON.stringify(pou.data.body)) as unknown as string) : undefined,
        ladderFlow:
          flowIndex !== -1
            ? (JSON.parse(JSON.stringify(ladderFlows[flowIndex])) as HistorySnapshot['ladderFlow'])
            : undefined,
        fbdFlow:
          fbdIndex !== -1 ? (JSON.parse(JSON.stringify(fbdFlows[fbdIndex])) as HistorySnapshot['fbdFlow']) : undefined,
        globalVariables: globalVariables.length
          ? (JSON.parse(JSON.stringify(globalVariables)) as HistorySnapshot['globalVariables'])
          : [],
        tasks: tasks.length ? (JSON.parse(JSON.stringify(tasks)) as HistorySnapshot['tasks']) : [],
        instances: instances.length ? (JSON.parse(JSON.stringify(instances)) as HistorySnapshot['instances']) : [],
        dataTypes: isDataType
          ? (JSON.parse(JSON.stringify(dataTypes.find((dt) => dt.name === pouName))) as HistorySnapshot['dataTypes'])
          : undefined,
      }

      getState().historyActions.addPastHistory(pouName, currentSnapshot)

      const next = getState().historyActions.popFutureHistory(pouName)

      if (!next) {
        return
      }

      if (isResource) {
        const { setGlobalVariables, setTasks, setInstances } = getState().projectActions

        setGlobalVariables({ variables: (next?.globalVariables ?? []) as PLCVariable[] })
        setTasks({ tasks: next?.tasks ?? [] })
        setInstances({ instances: next?.instances ?? [] })

        return
      }

      if (isDataType && next.dataTypes) {
        const { applyDatatypeSnapshot } = getState().projectActions

        applyDatatypeSnapshot(pouName, next.dataTypes as unknown as PLCDataType)

        return
      }

      if (!isResource && pou) {
        getState().projectActions.applyPouSnapshot(
          pouName,
          next.variables as PLCVariable[],
          next.body as typeof pou.data.body,
        )
      }

      getState().ladderFlowActions.applyLadderFlowSnapshot({
        editorName: pouName,
        snapshot: next.ladderFlow as LadderFlowType | null,
      })

      getState().fbdFlowActions.applyFBDFlowSnapshot({
        editorName: pouName,
        snapshot: next.fbdFlow as FBDFlowType | null,
      })
    },
  },
})

export type SharedSliceToCreate = typeof createSharedSlice
