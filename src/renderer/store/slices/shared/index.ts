import { ISaveDataResponse } from '@root/main/modules/ipc/renderer'
import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import {
  DeleteDatatype,
  DeletePou,
  DeleteRemoteDevice,
  DeleteServer,
} from '@root/renderer/components/_organisms/modals'
import { syncNodesWithVariables, syncNodesWithVariablesFBD } from '@root/renderer/utils/sync-nodes-with-variables'
import { CreateProjectFileProps, IProjectServiceResponse } from '@root/types/IPC/project-service'
import { PLCVariable as VariablePLC } from '@root/types/PLC'
import {
  PLCArrayDatatype,
  PLCDataType,
  PLCEnumeratedDatatype,
  PLCPou,
  PLCProject,
  PLCProjectSchema,
  PLCStructureDatatype,
  PLCVariable,
} from '@root/types/PLC/open-plc'
import { parseIecStringToVariables } from '@root/utils/generate-iec-string-to-variables'
import { generateIecVariablesToString } from '@root/utils/generate-iec-variables-to-string'
import { generatePouCopyUniqueName } from '@root/utils/generate-pou-copy-unique-name'
import { getExtensionFromLanguage } from '@root/utils/PLC/pou-file-extensions'
import { StateCreator } from 'zustand'

import { ConsoleSlice } from '../console'
import { deviceConfigurationSchema, devicePinSchema, DeviceSlice, DeviceState } from '../device'
import { EditorModel, EditorSlice } from '../editor'
import { FBDFlowSlice, FBDFlowType, ZodFBDFlowType } from '../fbd'
import { duplicateFBDRung } from '../fbd/utils'
import { FileSlice, FileSliceDataObject } from '../files'
import { HistorySlice, HistorySnapshot } from '../history'
import { LadderFlowSlice, LadderFlowType, ZodLadderFlowType } from '../ladder'
import { duplicateLadderRung } from '../ladder/utils'
import { LibrarySlice } from '../library'
import { ModalSlice } from '../modal'
import { ProjectSlice, ProjectState } from '../project'
import { TabsProps, TabsSlice } from '../tabs'
import { CreateEditorObjectFromTab } from '../tabs/utils'
import { WorkspaceSlice } from '../workspace'
import { CreateEditorObject, CreatePouObject } from './utils'

type PropsToCreatePou = {
  name: string
  type: 'program' | 'function' | 'function-block'
  language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp'
}

export type BasicSharedSliceResponse = {
  success: boolean
  error?: { title: string; description: string }
}

export type SharedSlice = {
  pouActions: {
    create: (propsToCreatePou: PropsToCreatePou) => Promise<BasicSharedSliceResponse>
    update: () => void
    deleteRequest: (pouName: string) => void
    delete: (data: DeletePou) => Promise<BasicSharedSliceResponse>
    rename: (pouName: string, newPouName: string) => Promise<BasicSharedSliceResponse>
    duplicate: (pouName: string) => Promise<BasicSharedSliceResponse>
  }
  datatypeActions: {
    create: (
      propsToCreateDatatype: PLCArrayDatatype | PLCEnumeratedDatatype | PLCStructureDatatype,
    ) => BasicSharedSliceResponse
    update: () => void
    deleteRequest: (datatypeName: string) => void
    delete: (data: DeleteDatatype) => Promise<BasicSharedSliceResponse>
    rename: (datatypeName: string, newDatatypeName: string) => Promise<BasicSharedSliceResponse>
    duplicate: (datatypeName: string) => Promise<BasicSharedSliceResponse>
  }
  serverActions: {
    deleteRequest: (serverName: string) => void
    delete: (data: DeleteServer) => Promise<BasicSharedSliceResponse>
    rename: (serverName: string, newServerName: string) => Promise<BasicSharedSliceResponse>
  }
  remoteDeviceActions: {
    deleteRequest: (remoteDeviceName: string) => void
    delete: (data: DeleteRemoteDevice) => Promise<BasicSharedSliceResponse>
    rename: (remoteDeviceName: string, newRemoteDeviceName: string) => Promise<BasicSharedSliceResponse>
  }
  sharedWorkspaceActions: {
    // Clear all states when closing a project
    clearStatesOnCloseProject: () => void
    // Close project operation
    closeProject: () => void
    // Open project operations
    handleOpenProjectRequest: (data: IProjectServiceResponse['data']) => void
    openProject: () => Promise<BasicSharedSliceResponse>
    openProjectByPath: (projectPath: string) => Promise<BasicSharedSliceResponse>
    openRecentProject: (response: IProjectServiceResponse) => BasicSharedSliceResponse
    // Create project operation
    createProject: (dataToCreateProjectFile: CreateProjectFileProps) => Promise<BasicSharedSliceResponse>
    // Save project operation
    saveProject: (project: ProjectState, device: DeviceState['deviceDefinitions']) => Promise<ISaveDataResponse>
    // File operations
    openFile: (data: TabsProps) => BasicSharedSliceResponse
    closeFile: (name: string) => BasicSharedSliceResponse
    saveFile: (name: string) => Promise<BasicSharedSliceResponse>
    // File and workspace saved state management
    handleFileAndWorkspaceSavedState: (name: string) => void
  }
  snapshotActions: {
    addSnapshot: (pouName: string) => void
    undo: (pouName: string) => void
    redo: (pouName: string) => void
  }
}

const sanitizePou = (pou: PLCPou, editor: EditorModel | undefined): PLCPou => {
  if (!editor || (editor.type !== 'plc-textual' && editor.type !== 'plc-graphical')) {
    return pou
  }

  if (editor.variable.display === 'code' && editor.variable.code != null) {
    return {
      type: pou.type,
      data: {
        ...pou.data,
        variablesText: editor.variable.code,
      },
    } as typeof pou
  } else {
    // When not in code mode or code is undefined, preserve the POU as-is without stripping variablesText
    return pou
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
    FileSlice &
    ConsoleSlice &
    HistorySlice &
    SharedSlice,
  [],
  [],
  SharedSlice
> = (_setState, getState) => ({
  pouActions: {
    create: async (propsToCreatePou: PropsToCreatePou) => {
      const newPouData = CreatePouObject(propsToCreatePou)

      /**
       * First create the POU in the project (client-side).
       * This will allow the editor to be updated with the new POU and it is easier to make validations.
       */
      const res = getState().projectActions.createPou(newPouData)
      if (!res.ok) {
        toast({
          title: 'Error creating POU',
          description: `POU "${propsToCreatePou.name}" could not be created.`,
          variant: 'fail',
        })
        return {
          success: false,
          error: {
            title: 'Error creating POU',
            description: `POU "${propsToCreatePou.name}" could not be created.`,
          },
        }
      }

      const projectPath = getState().project.meta.path
      const pouPath = `/pous/${propsToCreatePou.type}s/${propsToCreatePou.name}.json`
      const path = `${projectPath}${pouPath}`

      /**
       * Then, create the POU file in the filesystem.
       * This will allow the POU to be saved and loaded correctly.
       */
      try {
        const response = await window.bridge.createPouFile({
          path,
          pou: newPouData,
        })
        if (!response.success) {
          getState().projectActions.deletePou(propsToCreatePou.name)
          return {
            success: false,
            error: {
              title: 'Error creating POU',
              description: response.error
                ? response.error.description
                : `POU "${propsToCreatePou.name}" could not be created.`,
            },
          }
        }
      } catch (error) {
        console.error('Error creating POU file:', error)
        getState().projectActions.deletePou(propsToCreatePou.name)
        return {
          success: false,
          error: {
            title: 'Error creating POU',
            description: `An error occurred while creating the POU "${propsToCreatePou.name}".`,
          },
        }
      }

      let editorData: EditorModel
      // Textual languages
      if (
        propsToCreatePou.language === 'il' ||
        propsToCreatePou.language === 'st' ||
        propsToCreatePou.language === 'python' ||
        propsToCreatePou.language === 'cpp'
      ) {
        editorData = CreateEditorObject({
          type: 'plc-textual',
          meta: {
            name: propsToCreatePou.name,
            language: propsToCreatePou.language,
            path: pouPath,
            pouType: propsToCreatePou.type,
          },
          variable: {
            display: 'table',
            description: '',
            classFilter: 'All',
            selectedRow: '-1',
          },
        })
      }
      // Graphical languages
      else {
        editorData = CreateEditorObject({
          type: 'plc-graphical',
          meta: {
            name: propsToCreatePou.name,
            language: propsToCreatePou.language,
            path: pouPath,
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
      }

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

      if (propsToCreatePou.type !== 'program')
        getState().libraryActions.addLibrary(propsToCreatePou.name, propsToCreatePou.type)

      // Add the file to the file slice
      getState().fileActions.addFile({
        name: propsToCreatePou.name,
        type: propsToCreatePou.type,
        filePath: pouPath,
      })

      // Add and set the editor
      getState().editorActions.addModel(editorData)
      getState().editorActions.setEditor(editorData)

      // Add and set the tab
      getState().tabsActions.updateTabs({
        name: propsToCreatePou.name,
        path: pouPath,
        elementType: {
          type: propsToCreatePou.type,
          language: propsToCreatePou.language,
        },
      })
      getState().tabsActions.setSelectedTab(propsToCreatePou.name)

      // Set selected project tree leaf
      getState().workspaceActions.setSelectedProjectTreeLeaf({
        label: propsToCreatePou.name,
        type: propsToCreatePou.type,
      })

      return {
        success: true,
      }
    },

    update: () => {},

    deleteRequest: (pouName) => {
      const pou = getState().project.data.pous.find((pou) => pou.data.name === pouName)
      if (!pou) {
        toast({
          title: 'Error',
          description: `POU with name ${pouName} not found.`,
          variant: 'fail',
        })
        return
      }

      const modalData: DeletePou = {
        type: 'pou',
        file: pou.data.name,
        path: `/pous/${pou.type}s/${pou.data.name}.json`,
        pou,
      }

      getState().modalActions.openModal('confirm-delete-element', modalData)
    },

    delete: (data) => {
      const { file: targetLabel } = data

      getState().projectActions.deletePou(targetLabel)
      getState().ladderFlowActions.removeLadderFlow(targetLabel)
      getState().fbdFlowActions.removeFBDFlow(targetLabel)
      getState().tabsActions.removeTab(targetLabel)
      getState().editorActions.removeModel(targetLabel)
      getState().libraryActions.removeUserLibrary(targetLabel)
      getState().fileActions.removeFile({ name: targetLabel })

      const selectedProjectTreeLeaf = getState().workspace.selectedProjectTreeLeaf
      if (selectedProjectTreeLeaf.label === data.file) {
        getState().workspaceActions.setSelectedProjectTreeLeaf({
          label: '',
          type: null,
        })
      }

      return Promise.resolve({
        success: true,
      })
    },

    rename: async (pouName, newPouName) => {
      /**
       * Basic name validation
       */
      if (pouName === newPouName)
        return {
          success: false,
        }

      if (!(newPouName ?? '').trim()) {
        toast({ title: 'Error', description: 'New name must be non-empty.', variant: 'fail' })
        return {
          success: false,
          error: {
            title: 'Error renaming POU',
            description: 'New name must be non-empty.',
          },
        }
      }

      /**
       * Check if the new POU name is already used in the project.
       */
      const isPouNameAlreadyUsed =
        getState().project.data.pous.some((pou) => pou.data.name === newPouName) ||
        getState().project.data.dataTypes.some((datatype) => datatype.name === newPouName)
      if (isPouNameAlreadyUsed) {
        toast({
          title: 'Error renaming POU',
          description: `Datatype or POU with name ${newPouName} already exists.`,
          variant: 'fail',
        })
        return {
          success: false,
          error: {
            title: 'Error renaming POU',
            description: `Datatype or POU with name ${newPouName} already exists.`,
          },
        }
      }

      const pou = getState().project.data.pous.find((pou) => pou.data.name === pouName)
      if (!pou) {
        toast({
          title: 'Error',
          description: `POU with name ${pouName} not found.`,
          variant: 'fail',
        })
        return {
          success: false,
          error: {
            title: 'Error renaming POU',
            description: `POU with name ${pouName} not found.`,
          },
        }
      }

      const { file } = getState().fileActions.getFile({ name: pouName })
      if (!file) {
        toast({
          title: 'Error',
          description: `File for POU with name ${pouName} not found.`,
          variant: 'fail',
        })
        return {
          success: false,
          error: {
            title: 'Error renaming POU',
            description: `File for POU with name ${pouName} not found.`,
          },
        }
      }

      const projectPath = getState().project.meta.path
      const filePath = file.filePath.includes(projectPath) ? file.filePath : `${projectPath}${file.filePath}`
      try {
        const response = await window.bridge.renamePouFile({
          filePath,
          newFileName: `${newPouName}.json`,
          fileContent: pou,
        })
        if (!response.success) {
          console.error('Error renaming POU file:', response.error)
          toast({
            title: 'Error renaming POU',
            description: `An error occurred while renaming the POU "${pouName}".`,
            variant: 'fail',
          })
          return {
            success: false,
            error: {
              title: 'Error renaming POU',
              description: response.error ? response.error.description : `POU "${pouName}" could not be renamed.`,
            },
          }
        }
      } catch (error) {
        console.error('Error renaming POU file:', error)
        toast({
          title: 'Error renaming POU',
          description: `An error occurred while renaming the POU "${pouName}".`,
          variant: 'fail',
        })
        return {
          success: false,
          error: {
            title: 'Error renaming POU',
            description: `An error occurred while renaming the POU "${pouName}".`,
          },
        }
      }

      getState().projectActions.updatePouName(pouName, newPouName)
      const newPou = getState().project.data.pous.find((pou) => pou.data.name === newPouName)
      if (!newPou) {
        toast({
          title: 'Error renaming POU',
          description: `An error occurred while renaming the POU "${pouName}".`,
          variant: 'fail',
        })
        return {
          success: false,
          error: {
            title: 'Error renaming POU',
            description: `An error occurred while renaming the POU "${pouName}".`,
          },
        }
      }

      switch (newPou.data.language) {
        case 'ld': {
          const ladderFlow = getState().ladderFlows.find((lf) => lf.name === pouName)
          const copiedLadderFlow = {
            name: newPou.data.name,
            rungs: ladderFlow ? ladderFlow.rungs.map((rung) => duplicateLadderRung(newPou.data.name, rung)) : [],
            updated: true,
          }
          getState().ladderFlowActions.removeLadderFlow(pouName)
          getState().ladderFlowActions.addLadderFlow(copiedLadderFlow)
          getState().projectActions.updatePou({
            name: newPou.data.name,
            content: {
              language: newPou.data.language,
              value: copiedLadderFlow as ZodLadderFlowType,
            },
          })
          break
        }
        case 'fbd': {
          const fbdFlow = getState().fbdFlows.find((ff) => ff.name === pouName)
          const copiedFBDFlow = {
            name: newPou.data.name,
            rung: fbdFlow ? duplicateFBDRung(fbdFlow.rung) : { comment: '', nodes: [], edges: [], selectedNodes: [] },
            updated: true,
          }
          getState().fbdFlowActions.removeFBDFlow(pouName)
          getState().fbdFlowActions.addFBDFlow(copiedFBDFlow)
          getState().projectActions.updatePou({
            name: newPou.data.name,
            content: {
              language: newPou.data.language,
              value: copiedFBDFlow as ZodFBDFlowType,
            },
          })
          break
        }
        default:
          break
      }

      getState().tabsActions.updateTabName(pouName, newPouName)
      getState().editorActions.updateEditorName(pouName, newPouName)
      getState().fileActions.updateFile({
        name: pouName,
        newName: newPouName,
        filePath: `/pous/${pou.type}s/${newPouName}.json`,
        saved: true,
      })

      const selectedProjectTreeLeaf = getState().workspace.selectedProjectTreeLeaf
      if (selectedProjectTreeLeaf.label === pouName) {
        getState().workspaceActions.setSelectedProjectTreeLeaf({
          label: newPouName,
          type: selectedProjectTreeLeaf.type,
        })
      }

      if (newPou.type !== 'program') {
        getState().libraryActions.updateLibraryName(pouName, newPouName)
      }

      return await getState().sharedWorkspaceActions.saveFile(newPouName)
    },

    duplicate: async (pouName: string) => {
      const originalPou = getState().project.data.pous.find((pou) => pou.data.name === pouName)
      if (!originalPou) {
        toast({
          title: 'Error duplicating POU',
          description: `POU with name ${pouName} not found.`,
          variant: 'fail',
        })
        return {
          success: false,
          error: {
            title: 'Error duplicating POU',
            description: `POU with name ${pouName} not found.`,
          },
        }
      }

      /**
       * Get all names.
       */
      const allNames = [
        ...getState().project.data.pous.map((pou) => pou.data.name),
        ...getState().project.data.dataTypes.map((datatype) => datatype.name),
      ]

      const copiedPou = {
        type: originalPou.type,
        data: {
          ...originalPou.data,
          name: generatePouCopyUniqueName(originalPou.data.name, allNames),
        },
      } as PLCPou

      try {
        const res = await window.bridge.createPouFile({
          path: `${getState().project.meta.path}/pous/${copiedPou.type}s/${copiedPou.data.name}.json`,
          pou: copiedPou,
        })
        if (!res.success) throw new Error(res.error?.description || 'Error creating duplicated POU file')
      } catch (_error) {
        console.error(_error)
        toast({
          title: 'Error creating duplicated POU file',
          description: 'An error occurred while creating the duplicated POU file.',
          variant: 'fail',
        })
        return {
          success: false,
          error: {
            title: 'Error creating duplicated POU file',
            description: 'An error occurred while creating the duplicated POU file.',
          },
        }
      }

      switch (copiedPou.data.language) {
        case 'ld': {
          const originalLadderFlow = getState().ladderFlows.find((lf) => lf.name === originalPou.data.name)
          const copiedLadderFlow = {
            name: copiedPou.data.name,
            rungs: originalLadderFlow
              ? [...originalLadderFlow.rungs.map((rung) => duplicateLadderRung(copiedPou.data.name, rung))]
              : [],
            updated: true,
          }
          copiedPou.data.body.value =
            copiedPou.data.body.language === 'ld'
              ? ({ name: copiedLadderFlow.name, rungs: copiedLadderFlow.rungs } as ZodLadderFlowType)
              : ({ name: copiedLadderFlow.name, rungs: [] } as ZodLadderFlowType)
          getState().ladderFlowActions.addLadderFlow(copiedLadderFlow)
          break
        }
        case 'fbd': {
          const originalFBDFlow = getState().fbdFlows.find((ff) => ff.name === originalPou.data.name)
          const copiedFBDFlow = {
            name: copiedPou.data.name,
            rung: originalFBDFlow
              ? duplicateFBDRung(originalFBDFlow.rung)
              : { comment: '', nodes: [], edges: [], selectedNodes: [] },
            updated: true,
          }
          copiedPou.data.body.value =
            copiedPou.data.body.language === 'fbd'
              ? ({ name: copiedFBDFlow.name, rung: copiedFBDFlow.rung } as ZodFBDFlowType)
              : ({
                  name: copiedFBDFlow.name,
                  rung: { comment: '', nodes: [], edges: [], selectedNodes: [] },
                } as ZodFBDFlowType)
          getState().fbdFlowActions.addFBDFlow(copiedFBDFlow)
          break
        }
        default:
          break
      }

      getState().projectActions.createPou(copiedPou)
      getState().fileActions.addFile({
        name: copiedPou.data.name,
        type: copiedPou.type,
        filePath: `/pous/${copiedPou.type}s/${copiedPou.data.name}.json`,
      })
      if (copiedPou.type !== 'program') getState().libraryActions.addLibrary(copiedPou.data.name, copiedPou.type)

      return { success: true }
    },
  },
  datatypeActions: {
    create: (propsToCreateDatatype: PLCArrayDatatype | PLCEnumeratedDatatype | PLCStructureDatatype) => {
      getState().projectActions.createDatatype({ data: propsToCreateDatatype })

      // Add the file to the file slice
      getState().fileActions.addFile({
        name: propsToCreateDatatype.name,
        type: 'data-type',
        filePath: `/project.json`,
      })

      // Add and set the editor
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

      // Add and set the tab
      getState().tabsActions.updateTabs({
        name: propsToCreateDatatype.name,
        elementType: { type: 'data-type', derivation: propsToCreateDatatype.derivation },
        path: `/project.json`,
      })
      getState().tabsActions.setSelectedTab(propsToCreateDatatype.name)

      // Set selected project tree leaf
      getState().workspaceActions.setSelectedProjectTreeLeaf({
        label: propsToCreateDatatype.name,
        type: 'data-type',
      })

      return {
        success: true,
      }
    },

    update: () => {},

    deleteRequest: () => {
      const { selectedProjectTreeLeaf } = getState().workspace
      const { label } = selectedProjectTreeLeaf

      const datatype = getState().project.data.dataTypes.find((dt) => dt.name === label)
      if (!datatype) {
        toast({
          title: 'Error',
          description: `Datatype with name ${label} not found.`,
          variant: 'fail',
        })
        return
      }

      const modalData: DeleteDatatype = {
        type: 'datatype',
        file: datatype.name,
        path: `/project.json`,
      }

      getState().modalActions.openModal('confirm-delete-element', modalData)
    },

    delete: async (data) => {
      getState().projectActions.deleteDatatype(data.file)
      getState().tabsActions.removeTab(data.file)
      getState().editorActions.removeModel(data.file)
      getState().libraryActions.removeUserLibrary(data.file)

      const selectedProjectTreeLeaf = getState().workspace.selectedProjectTreeLeaf
      if (selectedProjectTreeLeaf.label === data.file) {
        getState().workspaceActions.setSelectedProjectTreeLeaf({
          label: '',
          type: null,
        })
      }

      return await getState().sharedWorkspaceActions.saveFile(data.file)
    },

    rename: async (datatypeName, newDatatypeName) => {
      /**
       * Basic name validation
       */
      if (datatypeName === newDatatypeName)
        return {
          success: false,
        }

      if (!(newDatatypeName ?? '').trim()) {
        toast({ title: 'Error', description: 'New name must be non-empty.', variant: 'fail' })
        return {
          success: false,
          error: {
            title: 'Error renaming POU',
            description: 'New name must be non-empty.',
          },
        }
      }

      /**
       * Check if the new POU name is already used in the project.
       */
      const isDatatypeNameAlreadyUsed =
        getState().project.data.pous.some((pou) => pou.data.name === newDatatypeName) ||
        getState().project.data.dataTypes.some((datatype) => datatype.name === newDatatypeName)
      if (isDatatypeNameAlreadyUsed) {
        toast({
          title: 'Error renaming Datatype',
          description: `Datatype or POU with name ${newDatatypeName} already exists.`,
          variant: 'fail',
        })
        return {
          success: false,
          error: {
            title: 'Error renaming Datatype',
            description: `Datatype or POU with name ${newDatatypeName} already exists.`,
          },
        }
      }

      const datatype = getState().project.data.dataTypes.find((dt) => dt.name === datatypeName)
      if (!datatype) {
        toast({
          title: 'Error',
          description: `Datatype with name ${datatypeName} not found.`,
          variant: 'fail',
        })
        return {
          success: false,
          error: {
            title: 'Error renaming Datatype',
            description: `Datatype with name ${datatypeName} not found.`,
          },
        }
      }

      getState().projectActions.updateDatatype(datatypeName, {
        ...datatype,
        name: newDatatypeName,
      })
      getState().tabsActions.updateTabName(datatypeName, newDatatypeName)
      getState().editorActions.updateEditorName(datatypeName, newDatatypeName)
      getState().fileActions.updateFile({
        name: datatypeName,
        newName: newDatatypeName,
        saved: true,
      })

      const selectedProjectTreeLeaf = getState().workspace.selectedProjectTreeLeaf
      if (selectedProjectTreeLeaf.label === datatypeName) {
        getState().workspaceActions.setSelectedProjectTreeLeaf({
          label: newDatatypeName,
          type: selectedProjectTreeLeaf.type,
        })
      }

      return await getState().sharedWorkspaceActions.saveFile(newDatatypeName)
    },

    duplicate: async (datatypeName) => {
      const originalDatatype = getState().project.data.dataTypes.find((dt) => dt.name === datatypeName)

      if (!originalDatatype) {
        toast({
          title: 'Error duplicating Datatype',
          description: `Datatype with name ${datatypeName} not found.`,
          variant: 'fail',
        })
        return {
          success: false,
          error: {
            title: 'Error duplicating Datatype',
            description: `Datatype with name ${datatypeName} not found.`,
          },
        }
      }

      /**
       * Get all names.
       */
      const allNames = [
        ...getState().project.data.pous.map((pou) => pou.data.name),
        ...getState().project.data.dataTypes.map((datatype) => datatype.name),
      ]

      const copiedDatatype = {
        ...originalDatatype,
        name: generatePouCopyUniqueName(originalDatatype.name, allNames),
      }

      getState().projectActions.createDatatype({ data: copiedDatatype })
      getState().fileActions.addFile({
        name: copiedDatatype.name,
        type: 'data-type',
        filePath: `/project.json`,
      })

      return await getState().sharedWorkspaceActions.saveFile(copiedDatatype.name)
    },
  },

  serverActions: {
    deleteRequest: (serverName) => {
      const server = getState().project.data.servers?.find((s) => s.name === serverName)
      if (!server) {
        toast({
          title: 'Error',
          description: `Server with name ${serverName} not found.`,
          variant: 'fail',
        })
        return
      }

      const modalData: DeleteServer = {
        type: 'server',
        file: server.name,
        path: `/devices/servers/${server.name}.json`,
      }

      getState().modalActions.openModal('confirm-delete-element', modalData)
    },

    delete: async (data) => {
      const deleteResult = getState().projectActions.deleteServer(data.file)
      if (!deleteResult.ok) {
        return {
          success: false,
          error: {
            title: 'Error',
            description: deleteResult.message || 'Failed to delete server',
          },
        }
      }

      getState().tabsActions.removeTab(data.file)
      getState().editorActions.removeModel(data.file)

      const selectedProjectTreeLeaf = getState().workspace.selectedProjectTreeLeaf
      if (selectedProjectTreeLeaf.label === data.file) {
        getState().workspaceActions.setSelectedProjectTreeLeaf({
          label: '',
          type: null,
        })
      }

      // Mark workspace as unsaved - servers are saved with project.json
      getState().workspaceActions.setEditingState('unsaved')
      return Promise.resolve({ success: true })
    },

    rename: (serverName, newServerName) => {
      if (serverName === newServerName) {
        return Promise.resolve({ success: false })
      }

      if (!(newServerName ?? '').trim()) {
        toast({ title: 'Error', description: 'New name must be non-empty.', variant: 'fail' })
        return Promise.resolve({
          success: false,
          error: {
            title: 'Error renaming server',
            description: 'New name must be non-empty.',
          },
        })
      }

      const servers = getState().project.data.servers
      const isServerNameAlreadyUsed = servers?.some((s) => s.name === newServerName)
      if (isServerNameAlreadyUsed) {
        toast({
          title: 'Error renaming server',
          description: `Server with name ${newServerName} already exists.`,
          variant: 'fail',
        })
        return Promise.resolve({
          success: false,
          error: {
            title: 'Error renaming server',
            description: `Server with name ${newServerName} already exists.`,
          },
        })
      }

      const server = servers?.find((s) => s.name === serverName)
      if (!server) {
        toast({
          title: 'Error',
          description: `Server with name ${serverName} not found.`,
          variant: 'fail',
        })
        return Promise.resolve({
          success: false,
          error: {
            title: 'Error renaming server',
            description: `Server with name ${serverName} not found.`,
          },
        })
      }

      getState().projectActions.updateServerName(serverName, newServerName)
      getState().tabsActions.updateTabName(serverName, newServerName)
      getState().editorActions.updateEditorName(serverName, newServerName)

      const selectedProjectTreeLeaf = getState().workspace.selectedProjectTreeLeaf
      if (selectedProjectTreeLeaf.label === serverName) {
        getState().workspaceActions.setSelectedProjectTreeLeaf({
          label: newServerName,
          type: selectedProjectTreeLeaf.type,
        })
      }

      // Mark workspace as unsaved - servers are saved with project.json
      getState().workspaceActions.setEditingState('unsaved')
      return Promise.resolve({ success: true })
    },
  },

  remoteDeviceActions: {
    deleteRequest: (remoteDeviceName) => {
      const remoteDevice = getState().project.data.remoteDevices?.find((d) => d.name === remoteDeviceName)
      if (!remoteDevice) {
        toast({
          title: 'Error',
          description: `Remote device with name ${remoteDeviceName} not found.`,
          variant: 'fail',
        })
        return
      }

      const modalData: DeleteRemoteDevice = {
        type: 'remote-device',
        file: remoteDevice.name,
        path: `/devices/remote/${remoteDevice.name}.json`,
      }

      getState().modalActions.openModal('confirm-delete-element', modalData)
    },

    delete: async (data) => {
      const deleteResult = getState().projectActions.deleteRemoteDevice(data.file)
      if (!deleteResult.ok) {
        return {
          success: false,
          error: {
            title: 'Error',
            description: deleteResult.message || 'Failed to delete remote device',
          },
        }
      }

      getState().tabsActions.removeTab(data.file)
      getState().editorActions.removeModel(data.file)

      const selectedProjectTreeLeaf = getState().workspace.selectedProjectTreeLeaf
      if (selectedProjectTreeLeaf.label === data.file) {
        getState().workspaceActions.setSelectedProjectTreeLeaf({
          label: '',
          type: null,
        })
      }

      // Mark workspace as unsaved - remote devices are saved with project.json
      getState().workspaceActions.setEditingState('unsaved')
      return Promise.resolve({ success: true })
    },

    rename: (remoteDeviceName, newRemoteDeviceName) => {
      if (remoteDeviceName === newRemoteDeviceName) {
        return Promise.resolve({ success: false })
      }

      if (!(newRemoteDeviceName ?? '').trim()) {
        toast({ title: 'Error', description: 'New name must be non-empty.', variant: 'fail' })
        return Promise.resolve({
          success: false,
          error: {
            title: 'Error renaming remote device',
            description: 'New name must be non-empty.',
          },
        })
      }

      const remoteDevices = getState().project.data.remoteDevices
      const isRemoteDeviceNameAlreadyUsed = remoteDevices?.some((d) => d.name === newRemoteDeviceName)
      if (isRemoteDeviceNameAlreadyUsed) {
        toast({
          title: 'Error renaming remote device',
          description: `Remote device with name ${newRemoteDeviceName} already exists.`,
          variant: 'fail',
        })
        return Promise.resolve({
          success: false,
          error: {
            title: 'Error renaming remote device',
            description: `Remote device with name ${newRemoteDeviceName} already exists.`,
          },
        })
      }

      const remoteDevice = remoteDevices?.find((d) => d.name === remoteDeviceName)
      if (!remoteDevice) {
        toast({
          title: 'Error',
          description: `Remote device with name ${remoteDeviceName} not found.`,
          variant: 'fail',
        })
        return Promise.resolve({
          success: false,
          error: {
            title: 'Error renaming remote device',
            description: `Remote device with name ${remoteDeviceName} not found.`,
          },
        })
      }

      getState().projectActions.updateRemoteDeviceName(remoteDeviceName, newRemoteDeviceName)
      getState().tabsActions.updateTabName(remoteDeviceName, newRemoteDeviceName)
      getState().editorActions.updateEditorName(remoteDeviceName, newRemoteDeviceName)

      const selectedProjectTreeLeaf = getState().workspace.selectedProjectTreeLeaf
      if (selectedProjectTreeLeaf.label === remoteDeviceName) {
        getState().workspaceActions.setSelectedProjectTreeLeaf({
          label: newRemoteDeviceName,
          type: selectedProjectTreeLeaf.type,
        })
      }

      // Mark workspace as unsaved - remote devices are saved with project.json
      getState().workspaceActions.setEditingState('unsaved')
      return Promise.resolve({ success: true })
    },
  },

  sharedWorkspaceActions: {
    clearStatesOnCloseProject: () => {
      getState().editorActions.clearEditor()
      getState().tabsActions.clearTabs()
      getState().libraryActions.clearUserLibraries()
      getState().fbdFlowActions.clearFBDFlows()
      getState().ladderFlowActions.clearLadderFlows()
      getState().projectActions.clearProjects()
      getState().deviceActions.clearDeviceDefinitions()
      getState().workspaceActions.clearWorkspace()
      getState().fileActions.clearFiles()
      getState().consoleActions.clearLogs()
      window.bridge.rebuildMenu()
    },

    closeProject: () => {
      const editingState = getState().workspace.editingState
      const isFilesSaved = getState().fileActions.checkIfAllFilesAreSaved(editingState)

      if (!isFilesSaved && editingState === 'unsaved') {
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

        const { project, pous, deviceConfiguration, devicePinMapping } = data.content

        const projectMeta = {
          name: project.meta.name,
          type: project.meta.type,
          path: data.meta.path,
        }
        const projectData = project.data

        // Set project data
        getState().projectActions.setProject({
          data: {
            ...projectData,
            deletedPous: [],
          },
          meta: projectMeta,
        })

        // Set pous
        getState().projectActions.setPous(pous)

        const ladderPous = pous.filter((pou) => pou.data.language === 'ld')
        if (ladderPous.length)
          ladderPous.forEach((pou) => {
            if (pou.data.body.language === 'ld')
              getState().ladderFlowActions.addLadderFlow(pou.data.body.value as LadderFlowType)
          })

        const fbdPous = pous.filter((pou) => pou.data.language === 'fbd')
        if (fbdPous.length)
          fbdPous.forEach((pou) => {
            if (pou.data.body.language === 'fbd')
              getState().fbdFlowActions.addFBDFlow(pou.data.body.value as FBDFlowType)
          })

        pous.map((pou) => pou.type !== 'program' && getState().libraryActions.addLibrary(pou.data.name, pou.type))

        const graphicalPous = [...ladderPous, ...fbdPous]
        if (graphicalPous.length) {
          const state = getState()
          const {
            project: {
              data: { dataTypes },
            },
            libraries,
          } = state

          graphicalPous.forEach((pou) => {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
            const iecString = generateIecVariablesToString(pou.data.variables as any)
            const reparsedVariables: PLCVariable[] = parseIecStringToVariables(iecString, pous, dataTypes, libraries)
            getState().projectActions.setPouVariables({
              pouName: pou.data.name,
              variables: reparsedVariables,
            })
          })

          const freshState = getState()
          const freshLadderFlows = freshState.ladderFlows
          const freshFBDFlows = freshState.fbdFlows
          const freshPous = freshState.project.data.pous
          const updateLadderNode = freshState.ladderFlowActions.updateNode
          const updateFBDNode = freshState.fbdFlowActions.updateNode

          ladderPous.forEach((pou) => {
            const freshPou = freshPous.find((p) => p.data.name === pou.data.name)
            if (freshPou) {
              const pouFlow = freshLadderFlows.filter((flow) => flow.name === pou.data.name)
              if (pouFlow.length > 0) {
                syncNodesWithVariables(freshPou.data.variables, pouFlow, updateLadderNode)
              }
            }
          })

          fbdPous.forEach((pou) => {
            const freshPou = freshPous.find((p) => p.data.name === pou.data.name)
            if (freshPou) {
              const pouFlow = freshFBDFlows.filter((flow) => flow.name === pou.data.name)
              if (pouFlow.length > 0) {
                syncNodesWithVariablesFBD(freshPou.data.variables, pouFlow, updateFBDNode)
              }
            }
          })
        }

        if (pous.length !== 0) {
          const mainPou = pous.find((pou) => pou.data.name === 'main' && pou.type === 'program')
          if (mainPou) {
            const tabToBeCreated: TabsProps = {
              name: mainPou.data.name,
              path: '/pous/programs/main.json',
              elementType: { type: 'program', language: mainPou.data.language },
            }

            // Add and set editor
            const model = CreateEditorObjectFromTab(tabToBeCreated)
            getState().editorActions.addModel(model)
            getState().editorActions.setEditor(model)

            // Add and set tab
            getState().tabsActions.updateTabs(tabToBeCreated)
            getState().tabsActions.setSelectedTab(tabToBeCreated.name)

            // Set selected project tree leaf
            getState().workspaceActions.setSelectedProjectTreeLeaf({
              label: mainPou.data.name,
              type: 'program',
            })
          }
        }

        // Set device definitions
        getState().deviceActions.setDeviceDefinitions({
          configuration: deviceConfiguration,
          pinMapping: devicePinMapping,
        })

        // Restore debug flags from debugVariables
        // Since POU variables are saved as text files, debug flags are stored separately in project.json
        const debugVariables = projectData.debugVariables
        if (debugVariables) {
          // Restore global variable debug flags
          if (debugVariables.global && debugVariables.global.length > 0) {
            const globalVars = getState().project.data.configuration.resource.globalVariables
            debugVariables.global.forEach((varName) => {
              const varIndex = globalVars.findIndex((v) => v.name === varName)
              if (varIndex !== -1) {
                getState().projectActions.updateVariable({
                  scope: 'global',
                  rowId: varIndex,
                  data: { debug: true },
                })
              }
            })
          }

          // Restore POU variable debug flags
          if (debugVariables.pous) {
            for (const [pouName, varNames] of Object.entries(debugVariables.pous)) {
              const pou = getState().project.data.pous.find((p) => p.data.name === pouName)
              if (pou) {
                varNames.forEach((varName) => {
                  const varIndex = pou.data.variables.findIndex((v) => v.name === varName)
                  if (varIndex !== -1) {
                    getState().projectActions.updateVariable({
                      scope: 'local',
                      associatedPou: pouName,
                      rowId: varIndex,
                      data: { debug: true },
                    })
                  }
                })
              }
            }
          }
        }

        // Set files in the file slice
        const files: FileSliceDataObject = {}
        pous.forEach((pou) => {
          files[pou.data.name] = {
            type: pou.type,
            filePath: `/pous/${pou.type}s/${pou.data.name}.json`,
            saved: true,
          }
        })
        projectData.dataTypes.forEach((datatype) => {
          files[datatype.name] = {
            type: 'data-type',
            filePath: `/project.json`,
            saved: true,
          }
        })
        files['Resource'] = {
          type: 'resource',
          filePath: `/project.json`,
          saved: true,
        }
        files['Configuration'] = {
          type: 'device',
          filePath: `/device`,
          saved: true,
        }
        getState().fileActions.setFiles({ files })

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

      window.bridge.rebuildMenu()

      getState().sharedWorkspaceActions.clearStatesOnCloseProject()

      getState().projectActions.setProject({
        meta: {
          name: dataToCreateProjectFile.name,
          type: dataToCreateProjectFile.type,
          path: dataToCreateProjectFile.path,
        },
        data: result.data.content.project.data,
      })

      const pous = result.data.content.pous
      getState().projectActions.setPous(pous)
      pous.forEach((pou) => {
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

      getState().workspaceActions.setEditingState('unsaved')

      const mainPou = pous.find((pou) => pou.data.name === 'main' && pou.type === 'program')
      if (mainPou) {
        const tabToBeCreated: TabsProps = {
          name: mainPou.data.name,
          path: '/pous/programs/main',
          elementType: { type: 'program', language: mainPou.data.language },
        }

        // Set files in the file slice
        const files: FileSliceDataObject = {}
        files[tabToBeCreated.name] = {
          type: 'program',
          filePath: `/pous/programs/${tabToBeCreated.name}.json`,
          saved: true,
        }
        files['Resource'] = {
          type: 'resource',
          filePath: `/project.json`,
          saved: true,
        }
        files['Configuration'] = {
          type: 'device',
          filePath: `/device`,
          saved: true,
        }
        getState().fileActions.setFiles({ files })

        // Add and set editor
        const model = CreateEditorObjectFromTab(tabToBeCreated)
        getState().editorActions.addModel(model)
        getState().editorActions.setEditor(model)

        // Add and set tab
        getState().tabsActions.updateTabs(tabToBeCreated)
        getState().tabsActions.setSelectedTab(tabToBeCreated.name)

        // Set selected project tree leaf
        getState().workspaceActions.setSelectedProjectTreeLeaf({
          label: mainPou.data.name,
          type: 'program',
        })
      }

      toast({
        title: 'The project was created successfully!',
        description: 'To begin using the OpenPLC Editor, add a new POU to your project.',
        variant: 'default',
      })

      return {
        success: true,
      }
    },

    saveProject: async (
      project: ProjectState,
      device: DeviceState['deviceDefinitions'],
    ): Promise<ISaveDataResponse> => {
      getState().workspaceActions.setEditingState('save-request')
      toast({
        title: 'Save changes',
        description: 'Trying to save the changes in the project file.',
        variant: 'warn',
      })

      const projectData = PLCProjectSchema.safeParse(project)
      if (!projectData.success) {
        console.error('Project validation failed:', projectData.error)
        console.error('Detailed errors:', JSON.stringify(projectData.error.issues, null, 2))
        getState().workspaceActions.setEditingState('unsaved')
        toast({
          title: 'Error in the save request!',
          description: 'The project data is not valid.',
          variant: 'fail',
        })
        return {
          success: false,
          reason: { title: 'Error in the save request!', description: 'The project data is not valid.' },
        }
      }

      const deviceConfiguration = deviceConfigurationSchema.safeParse(device.configuration)
      if (!deviceConfiguration.success) {
        getState().workspaceActions.setEditingState('unsaved')
        toast({
          title: 'Error in the save request!',
          description: 'The device configuration data is not valid.',
          variant: 'fail',
        })
        return {
          success: false,
          reason: { title: 'Error in the save request!', description: 'The device configuration data is not valid.' },
        }
      }

      const devicePinMapping = devicePinSchema.array().safeParse(device.pinMapping.pins)
      if (!devicePinMapping.success) {
        getState().workspaceActions.setEditingState('unsaved')
        toast({
          title: 'Error in the save request!',
          description: 'The device pin mapping data is not valid.',
          variant: 'fail',
        })
        return {
          success: false,
          reason: { title: 'Error in the save request!', description: 'The device pin mapping data is not valid.' },
        }
      }

      const editors = getState().editors
      const editorsByName = new Map(
        editors.filter((e) => e.type === 'plc-textual' || e.type === 'plc-graphical').map((e) => [e.meta.name, e]),
      )

      const activeEditor = getState().editor
      if (activeEditor.type === 'plc-textual' || activeEditor.type === 'plc-graphical') {
        editorsByName.set(activeEditor.meta.name, activeEditor)
      }

      const sanitizedPous = projectData.data.data.pous.map((p) => {
        const ed = editorsByName.get(p.data.name)
        return sanitizePou(p, ed)
      })

      // Remove the POU from the project data before saving
      // This is because the POU data is not needed in the project file
      // and it is stored in the filesystem
      // This is a workaround to avoid circular references
      // and to reduce the size of the project file
      const pous = sanitizedPous
      projectData.data.data.pous = []

      // Collect debug flags from all variables (global and POU variables)
      // Since POU variables are saved as text files, debug flags need to be stored separately
      const debugVariables: { global?: string[]; pous?: Record<string, string[]> } = {}

      // Collect global variable debug flags
      const globalDebugVars = project.data.configuration.resource.globalVariables
        .filter((v) => v.debug === true)
        .map((v) => v.name)
      if (globalDebugVars.length > 0) {
        debugVariables.global = globalDebugVars
      }

      // Collect POU variable debug flags
      const pouDebugVars: Record<string, string[]> = {}
      for (const pou of project.data.pous) {
        const debugVars = pou.data.variables.filter((v) => v.debug === true).map((v) => v.name)
        if (debugVars.length > 0) {
          pouDebugVars[pou.data.name] = debugVars
        }
      }
      if (Object.keys(pouDebugVars).length > 0) {
        debugVariables.pous = pouDebugVars
      }

      // Add debug variables to project data if any exist
      if (debugVariables.global || debugVariables.pous) {
        projectData.data.data.debugVariables = debugVariables
      } else {
        projectData.data.data.debugVariables = undefined
      }

      const { success, reason } = await window.bridge.saveProject({
        projectPath: project.meta.path,
        content: {
          projectData: projectData.data,
          pous,
          deviceConfiguration: deviceConfiguration.data,
          devicePinMapping: devicePinMapping.data,
          servers: project.data.servers,
          remoteDevices: project.data.remoteDevices,
        },
      })

      if (success) {
        getState().workspaceActions.setEditingState('saved')
        getState().fileActions.setAllToSaved()
        const currentProject = getState().project
        if (
          (currentProject.data.deletedPous && currentProject.data.deletedPous.length > 0) ||
          (currentProject.data.deletedServers && currentProject.data.deletedServers.length > 0) ||
          (currentProject.data.deletedRemoteDevices && currentProject.data.deletedRemoteDevices.length > 0)
        ) {
          getState().projectActions.setProject({
            ...currentProject,
            data: {
              ...currentProject.data,
              deletedPous: [],
              deletedServers: [],
              deletedRemoteDevices: [],
            },
          })
        }
        toast({
          title: 'Changes saved!',
          description: 'The project was saved successfully!',
          variant: 'default',
        })
      } else {
        getState().workspaceActions.setEditingState('unsaved')
        getState().fileActions.setAllToUnsaved()
        toast({
          title: 'Error in the save request!',
          description: reason?.description,
          variant: 'fail',
        })
      }

      return { success, reason }
    },

    // =========== File operations ===========
    openFile: ({ name, path, elementType }: TabsProps) => {
      const editorTabToBeCreated = { name, path, elementType }

      if (!editorTabToBeCreated.path) {
        toast({
          title: 'Error opening file',
          description: 'The file path is not defined.',
          variant: 'fail',
        })
        return {
          success: false,
          error: {
            title: 'Error opening file',
            description: 'The file path is not defined.',
          },
        }
      }

      // Define editor model at the editor slice
      let editor = getState().editorActions.getEditorFromEditors(editorTabToBeCreated.name)

      if (!editor) {
        editor = CreateEditorObjectFromTab(editorTabToBeCreated)
      }

      getState().editorActions.addModel(editor)
      getState().editorActions.setEditor(editor)

      // Check if POU has unparsed variablesText and initialize in code mode
      if (elementType.type === 'program' || elementType.type === 'function' || elementType.type === 'function-block') {
        const pou = getState().project.data.pous.find((p) => p.data.name === name)
        const hasVariablesText = pou && Object.prototype.hasOwnProperty.call(pou.data, 'variablesText')
        const variablesText = hasVariablesText
          ? (pou.data as typeof pou.data & { variablesText?: string }).variablesText
          : undefined

        if (hasVariablesText && variablesText !== undefined) {
          getState().editorActions.updateModelVariables({
            display: 'code',
            code: variablesText,
          })
        }
      }

      // Define tab at the tabs slice
      getState().tabsActions.updateTabs(editorTabToBeCreated)
      getState().tabsActions.setSelectedTab(editor.meta.name)

      // Set selected project tree leaf
      getState().workspaceActions.setSelectedProjectTreeLeaf({
        label: editor.meta.name,
        type: editorTabToBeCreated.elementType.type,
      })

      return { success: true }
    },
    closeFile: (name) => {
      // Remove the tab from the tabs slice
      getState().tabsActions.removeTab(name)

      // Check if there are any remaining tabs
      const filteredTabs = getState().tabs
      const nextTab = filteredTabs[filteredTabs.length - 1]
      if (!nextTab) {
        getState().editorActions.setEditor({
          type: 'available',
          meta: { name: '' },
        })
        getState().tabsActions.setSelectedTab('')
        getState().workspaceActions.setSelectedProjectTreeLeaf({
          label: '',
          type: null,
        })
        return { success: true }
      }

      // If there is no next tab, set the editor to available
      const editor = getState().editorActions.getEditorFromEditors(nextTab.name) || CreateEditorObjectFromTab(nextTab)
      getState().editorActions.setEditor(editor)
      getState().tabsActions.setSelectedTab(nextTab.name)
      getState().workspaceActions.setSelectedProjectTreeLeaf({
        label: nextTab.name,
        type: nextTab.elementType.type,
      })

      return { success: true }
    },
    saveFile: async (name) => {
      const { file } = getState().fileActions.getFile({ name: name })
      if (!file) {
        const editor = getState().editor
        if (editor.type === 'available') {
          return {
            success: false,
            error: {
              title: 'Error saving file',
              description: `There is no opened file. Editor is in available state.`,
            },
          }
        }

        toast({
          title: 'Error saving file',
          description: `File with name ${name} does not exist.`,
          variant: 'fail',
        })
        return {
          success: false,
          error: { title: 'Error saving file', description: `File with name ${name} does not exist.` },
        }
      }

      const projectFilePath = getState().project.meta.path
      let saveContent: PLCProject | PLCPou | DeviceState['deviceDefinitions'] | undefined
      let computedFilePath: string | undefined

      switch (file.type) {
        case 'function':
        case 'function-block':
        case 'program': {
          const editor = getState().editorActions.getEditorFromEditors(name)
          const pou = getState().project.data.pous.find((pou) => pou.data.name === name)

          const pouToSave = pou ? sanitizePou(pou, editor ?? undefined) : undefined

          if (pouToSave) {
            try {
              const language = pouToSave.data.body.language
              const extension = getExtensionFromLanguage(language)
              const typeDir =
                file.type === 'function' ? 'functions' : file.type === 'function-block' ? 'function-blocks' : 'programs'
              computedFilePath = `${projectFilePath}/pous/${typeDir}/${name}${extension}`
            } catch (_error) {
              // If language is not supported, fall back to using the original file.filePath
            }
          }

          saveContent = pouToSave
          break
        }
        case 'device': {
          const deviceConfiguration = deviceConfigurationSchema.safeParse(getState().deviceDefinitions.configuration)
          if (!deviceConfiguration.success) {
            toast({
              title: 'Error saving file',
              description: `File ${name} could not be saved. Device configuration is invalid.`,
              variant: 'fail',
            })
            return {
              success: false,
              error: {
                title: 'Error saving file',
                description: `File ${name} could not be saved. Device configuration is invalid.`,
              },
            }
          }

          const devicePinMapping = devicePinSchema.array().safeParse(getState().deviceDefinitions.pinMapping.pins)
          if (!devicePinMapping.success) {
            toast({
              title: 'Error saving file',
              description: `File ${name} could not be saved. Device pin mapping is invalid.`,
              variant: 'fail',
            })
            return {
              success: false,
              error: {
                title: 'Error saving file',
                description: `File ${name} could not be saved. Device pin mapping is invalid.`,
              },
            }
          }

          saveContent = {
            configuration: deviceConfiguration.data,
            pinMapping: {
              pins: devicePinMapping.data,
              currentSelectedPinTableRow: -1,
            },
          }
          break
        }
        case 'data-type':
        case 'resource': {
          const currentProject = getState().project
          const projectData = PLCProjectSchema.safeParse(currentProject)
          if (!projectData.success) {
            toast({
              title: 'Error saving file',
              description: `File ${name} could not be saved. Project data is invalid.`,
              variant: 'fail',
            })
            return {
              success: false,
              error: {
                title: 'Error saving file',
                description: `File ${name} could not be saved. Project data is invalid.`,
              },
            }
          }

          // Collect debug flags from all variables (global and POU variables)
          const debugVars: { global?: string[]; pous?: Record<string, string[]> } = {}

          const globalDebugVars = currentProject.data.configuration.resource.globalVariables
            .filter((v) => v.debug === true)
            .map((v) => v.name)
          if (globalDebugVars.length > 0) {
            debugVars.global = globalDebugVars
          }

          const pouDebugVars: Record<string, string[]> = {}
          for (const pou of currentProject.data.pous) {
            const vars = pou.data.variables.filter((v) => v.debug === true).map((v) => v.name)
            if (vars.length > 0) {
              pouDebugVars[pou.data.name] = vars
            }
          }
          if (Object.keys(pouDebugVars).length > 0) {
            debugVars.pous = pouDebugVars
          }

          // Ensure project.json doesn't contain POUs (POUs live as separate files)
          const sanitizedProject = {
            ...projectData.data,
            data: {
              ...projectData.data.data,
              pous: [],
              debugVariables: debugVars.global || debugVars.pous ? debugVars : undefined,
            },
          } as PLCProject
          saveContent = sanitizedProject
          break
        }
        default:
          break
      }

      if (!saveContent) {
        toast({
          title: 'Error saving file',
          description: `File ${name} could not be saved. Content is missing.`,
          variant: 'fail',
        })
        return {
          success: false,
          error: {
            title: 'Error saving file',
            description: `File ${name} could not be saved. Content is missing.`,
          },
        }
      }

      const filePath =
        computedFilePath ||
        (file.filePath.includes(projectFilePath) ? file.filePath : `${projectFilePath}${file.filePath}`)

      let saveResponse: { success: boolean; error?: string }
      switch (file.type) {
        case 'function':
        case 'function-block':
        case 'program':
          saveResponse = await window.bridge.saveFile(filePath, saveContent)
          break
        case 'device': {
          const deviceConfigSaveResponse = await window.bridge.saveFile(
            `${projectFilePath}/devices/configuration.json`,
            (saveContent as DeviceState['deviceDefinitions']).configuration,
          )
          const devicePinMappingSaveResponse = await window.bridge.saveFile(
            `${projectFilePath}/devices/pin-mapping.json`,
            (saveContent as DeviceState['deviceDefinitions']).pinMapping.pins,
          )
          saveResponse = {
            success: deviceConfigSaveResponse.success && devicePinMappingSaveResponse.success,
            error: deviceConfigSaveResponse.error || devicePinMappingSaveResponse.error,
          }
          break
        }
        case 'data-type':
        case 'resource':
          saveResponse = await window.bridge.saveFile(`${projectFilePath}/project.json`, saveContent)
          break
        default:
          saveResponse = { success: false, error: 'Unknown file type' }
          break
      }

      if (!saveResponse.success) {
        toast({
          title: 'Error saving file',
          description: `File ${name} could not be saved.`,
          variant: 'fail',
        })
        return {
          success: false,
          error: {
            title: 'Error saving file',
            description: saveResponse.error ? saveResponse.error : `File ${name} could not be saved.`,
          },
        }
      }

      getState().fileActions.updateFile({
        name,
        saved: true,
      })

      toast({
        title: 'File saved',
        description: `File ${name} has been saved successfully.`,
        variant: 'default',
      })
      return { success: true }
    },

    // File and workspace saved state management
    handleFileAndWorkspaceSavedState: (name: string) => {
      const { file } = getState().fileActions.getFile({ name })
      if (!file) {
        console.warn(`File with name ${name} does not exist.`)
      }

      // If the file is saved, set the saved to false because it was modified
      if (file?.saved) {
        console.warn(`File with name ${name} was marked as saved, but it was modified. Marking as unsaved.`)
        getState().fileActions.updateFile({
          name,
          saved: false,
        })
      }

      // If the workspace state is not 'unsaved', set it to 'unsaved' because a file was modified
      if (getState().workspace.editingState !== 'unsaved') {
        getState().workspaceActions.setEditingState('unsaved')
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

      if (isDataType) {
        const dataType = dataTypes.find((dataType) => dataType.name === pouName)!

        snapshot.dataTypes = JSON.parse(JSON.stringify(dataType)) as HistorySnapshot['dataTypes']
      }

      getState().historyActions.addPastHistory(pouName, snapshot)
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

      getState().fileActions.updateFile({
        name: pouName === 'resource' ? 'Resource' : pouName,
        saved: false,
      })

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

      const variables = previous.variables as PLCVariable[]
      if (variables.length > 0) {
        getState().editorActions.updateModelVariables({
          display: 'table',
          selectedRow: variables.length - 1,
        })
      } else {
        getState().editorActions.updateModelVariables({
          display: 'table',
          selectedRow: -1,
        })
      }
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

      getState().fileActions.updateFile({
        name: pouName === 'resource' ? 'Resource' : pouName,
        saved: false,
      })

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

      const variables = next.variables as PLCVariable[]

      if (variables.length > 0) {
        console.log(variables.length)

        getState().editorActions.updateModelVariables({
          display: 'table',
          selectedRow: variables.length - 1,
        })
      } else {
        getState().editorActions.updateModelVariables({
          display: 'table',
          selectedRow: -1,
        })
      }
    },
  },
})

export type SharedSliceToCreate = typeof createSharedSlice
