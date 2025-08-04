import { ISaveDataResponse } from '@root/main/modules/ipc/renderer'
import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import { DeleteDatatype, DeletePou } from '@root/renderer/components/_organisms/modals'
import { SaveFileChangeModalProps } from '@root/renderer/components/_organisms/modals/save-file-changes-modal'
import { CreateProjectFileProps, IProjectServiceResponse } from '@root/types/IPC/project-service'
import {
  PLCArrayDatatype,
  PLCEnumeratedDatatype,
  PLCProjectSchema,
  PLCStructureDatatype,
} from '@root/types/PLC/open-plc'
import { pouTypesArr } from '@root/types/PLC/pous'
import { StateCreator } from 'zustand'

import { deviceConfigurationSchema, devicePinSchema, DeviceSlice, DeviceState } from '../device'
import { EditorModel, EditorSlice } from '../editor'
import { FBDFlowSlice, FBDFlowType } from '../fbd'
import { FileSlice, FileSliceType } from '../files'
import { LadderFlowSlice, LadderFlowType } from '../ladder'
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
  language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd'
}

type BasicSharedSliceResponse = {
  success: boolean
  error?: { title: string; description: string }
}

export type SharedSlice = {
  pouActions: {
    create: (propsToCreatePou: PropsToCreatePou) => Promise<BasicSharedSliceResponse>
    update: () => void
    deleteRequest: (pouName: string) => void
    delete: (data: DeletePou) => Promise<BasicSharedSliceResponse>
  }
  datatypeActions: {
    create: (
      propsToCreateDatatype: PLCArrayDatatype | PLCEnumeratedDatatype | PLCStructureDatatype,
    ) => BasicSharedSliceResponse
    update: () => void
    deleteRequest: (datatypeName: string) => void
    delete: (data: DeleteDatatype) => BasicSharedSliceResponse
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
    closeFileRequest: (name: string | null) => void
    closeFile: (name: string) => BasicSharedSliceResponse
    saveFile: (name: string) => BasicSharedSliceResponse
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
      if (!res.ok) throw new Error()

      const projectPath = getState().project.meta.path
      const path = `${projectPath}/pous/${propsToCreatePou.type}s/${propsToCreatePou.name}.json`

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
      if (propsToCreatePou.language === 'il' || propsToCreatePou.language === 'st') {
        editorData = CreateEditorObject({
          type: 'plc-textual',
          meta: {
            name: propsToCreatePou.name,
            language: propsToCreatePou.language,
            path: path,
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
            path: path,
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
        type: 'pou',
        filePath: path,
      })

      // Add and set the editor
      getState().editorActions.addModel(editorData)
      getState().editorActions.setEditor(editorData)

      // Add and set the tab
      getState().tabsActions.updateTabs({
        name: propsToCreatePou.name,
        elementType: {
          type: propsToCreatePou.type,
          language: propsToCreatePou.language,
        },
      })
      getState().tabsActions.setSelectedTab(propsToCreatePou.name)

      // Set selected project tree leaf
      getState().workspaceActions.setSelectedProjectTreeLeaf({
        label: propsToCreatePou.name,
        type: 'pou',
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

      const projectPath = getState().project.meta.path

      const modalData: DeletePou = {
        type: 'pou',
        file: pou.data.name,
        path: `${projectPath}/pous/${pou.type}s/${pou.data.name}.json`,
        pou,
      }

      getState().modalActions.openModal('confirm-delete-element', modalData)
    },

    delete: async (data) => {
      const { file: targetLabel, path } = data

      try {
        const response = await window.bridge.deletePouFile(path)
        if (!response.success) {
          return {
            success: false,
            error: {
              title: 'Error deleting POU',
              description: response.error ? response.error.description : `POU "${targetLabel}" could not be deleted.`,
            },
          }
        }
      } catch (error) {
        console.error('Error deleting POU file:', error)
        return {
          success: false,
          error: {
            title: 'Error deleting POU',
            description: `An error occurred while deleting the POU "${targetLabel}".`,
          },
        }
      }

      getState().projectActions.deletePou(targetLabel)
      getState().ladderFlowActions.removeLadderFlow(targetLabel)
      getState().libraryActions.removeUserLibrary(targetLabel)

      return {
        success: true,
      }
    },
  },
  datatypeActions: {
    create: (propsToCreateDatatype: PLCArrayDatatype | PLCEnumeratedDatatype | PLCStructureDatatype) => {
      getState().projectActions.createDatatype({ data: propsToCreateDatatype })

      // Add the file to the file slice
      getState().fileActions.addFile({
        name: propsToCreateDatatype.name,
        type: 'data-type',
        filePath: `data/datatypes/${propsToCreateDatatype.name}`,
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
      })
      getState().tabsActions.setSelectedTab(propsToCreateDatatype.name)

      // Set selected project tree leaf
      getState().workspaceActions.setSelectedProjectTreeLeaf({
        label: propsToCreateDatatype.name,
        type: 'datatype',
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

      const projectPath = getState().project.meta.path

      const modalData: DeleteDatatype = {
        type: 'datatype',
        file: datatype.name,
        path: `${projectPath}/datatypes/${datatype.name}`,
      }

      getState().modalActions.openModal('confirm-delete-element', modalData)
    },

    delete: (data) => {
      getState().projectActions.deleteDatatype(data.file)
      getState().ladderFlowActions.removeLadderFlow(data.file)
      getState().libraryActions.removeUserLibrary(data.file)

      return {
        success: true,
      }
    },
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

        const { project, pous, deviceConfiguration, devicePinMapping } = data.content

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

        if (pous.length !== 0) {
          const mainPou = pous.find((pou) => pou.data.name === 'main' && pou.type === 'program')
          if (mainPou) {
            const tabToBeCreated: TabsProps = {
              name: mainPou.data.name,
              path: '/pous/programs/main',
              elementType: { type: 'program', language: mainPou.data.language },
            }

            // Add the file to the file slice
            getState().fileActions.addFile({
              name: tabToBeCreated.name,
              type: 'pou',
              filePath: `${data.meta.path}/pous/programs/${tabToBeCreated.name}.json`,
            })

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
              type: 'pou',
            })
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
      console.log('Project created:', result.data.content)
      getState().projectActions.setPous(result.data.content.pous)

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

      // Remove the POU from the project data before saving
      // This is because the POU data is not needed in the project file
      // and it is stored in the filesystem
      // This is a workaround to avoid circular references
      // and to reduce the size of the project file
      const pous = projectData.data.data.pous
      projectData.data.data.pous = []

      const { success, reason } = await window.bridge.saveProject({
        projectPath: project.meta.path,
        content: {
          projectData: projectData.data,
          pous,
          deviceConfiguration: deviceConfiguration.data,
          devicePinMapping: devicePinMapping.data,
        },
      })

      if (success) {
        getState().workspaceActions.setEditingState('saved')
        toast({
          title: 'Changes saved!',
          description: 'The project was saved successfully!',
          variant: 'default',
        })
      } else {
        getState().workspaceActions.setEditingState('unsaved')
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

      if (!editorTabToBeCreated.path)
        return {
          success: false,
          error: {
            title: 'Error opening file',
            description: 'The file path is not defined.',
          },
        }

      // Define file at the file slice
      const fileType: FileSliceType = pouTypesArr.includes(
        editorTabToBeCreated.elementType.type as (typeof pouTypesArr)[number],
      )
        ? 'pou'
        : editorTabToBeCreated.elementType.type === 'data-type'
          ? 'data-type'
          : 'device'
      getState().fileActions.addFile({
        name: editorTabToBeCreated.name,
        type: fileType,
        filePath: editorTabToBeCreated.path,
      })

      // Define editor model at the editor slice
      const editor =
        getState().editorActions.getEditorFromEditors(editorTabToBeCreated.name) ||
        CreateEditorObjectFromTab(editorTabToBeCreated)
      getState().editorActions.addModel(editor)
      getState().editorActions.setEditor(editor)

      // Define tab at the tabs slice
      getState().tabsActions.updateTabs(editorTabToBeCreated)
      getState().tabsActions.setSelectedTab(editor.meta.name)

      return { success: true }
    },
    closeFileRequest: (name) => {
      if (!name) {
        toast({
          title: 'Error closing file',
          description: 'File name is not defined.',
          variant: 'fail',
        })
        return
      }

      const { file } = getState().fileActions.getFile({ name })
      if (!file) {
        toast({
          title: 'Error closing file',
          description: `File with name ${name} does not exist.`,
          variant: 'fail',
        })
        return
      }
      if (!file.saved) {
        const modalData: Pick<SaveFileChangeModalProps, 'fileName' | 'validationContext'> = {
          fileName: name,
          validationContext: 'close-file',
        }
        getState().modalActions.openModal('save-changes-file', modalData)
        return
      }

      getState().sharedWorkspaceActions.closeFile(name)
    },
    closeFile: (name) => {
      // Remove the file from the file slice
      getState().fileActions.removeFile({ name })

      // Remove the tab from the tabs slice and the editor model from the editor slice
      const { tabs: filteredTabs } = getState().tabsActions.removeTab(name)
      getState().editorActions.removeModel(name)

      // Set the current tab and the current editor
      const nextTab = filteredTabs[filteredTabs.length - 1]
      if (!nextTab) {
        getState().editorActions.setEditor({
          type: 'available',
          meta: { name: '' },
        })
        getState().tabsActions.setSelectedTab('')
        return { success: true }
      }
      const editor = getState().editorActions.getEditorFromEditors(nextTab.name) || CreateEditorObjectFromTab(nextTab)
      getState().editorActions.setEditor(editor)
      getState().tabsActions.setSelectedTab(nextTab.name)

      return { success: true }
    },
    saveFile: (name) => {
      const { file } = getState().fileActions.getFile({ name: name })
      if (!file) {
        toast({
          title: 'Error saving file',
          description: `File with name ${name} does not exist.`,
          variant: 'fail',
        })
        return { success: false }
      }

      return { success: true }
    },
  },
})

export type SharedSliceToCreate = typeof createSharedSlice
