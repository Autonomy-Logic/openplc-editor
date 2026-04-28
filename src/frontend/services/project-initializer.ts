import type { PLCPou } from '../../middleware/shared/ports/types'
import type { FBDFlowType } from '../store/slices/fbd/types'
import type { FileSliceData } from '../store/slices/file/types'
import type { LadderFlowType } from '../store/slices/ladder/types'
import type { ProjectState } from '../store/slices/project/types'
import type { TabsProps } from '../store/slices/tabs/types'
import { CreateEditorObjectFromTab } from '../store/slices/tabs/utils'

function normalizeLadderFlow(flow: Record<string, unknown> | undefined, pouName: string): LadderFlowType {
  return {
    name: (flow?.name as string) || pouName,
    updated: flow?.updated !== undefined ? (flow.updated as boolean) : false,
    rungs: Array.isArray(flow?.rungs) ? (flow.rungs as LadderFlowType['rungs']) : [],
  }
}

type StoreActions = {
  projectActions: { setProject: (data: ProjectState) => void }
  editorActions: {
    addModel: (model: ReturnType<typeof CreateEditorObjectFromTab>) => void
    setEditor: (model: ReturnType<typeof CreateEditorObjectFromTab>) => void
    clearEditor: () => void
  }
  tabsActions: {
    updateTabs: (tab: TabsProps) => void
    clearTabs: () => void
  }
  fileActions: { setFiles: (data: { files: Record<string, FileSliceData> }) => void }
  ladderFlowActions: {
    addLadderFlow: (flow: LadderFlowType) => void
    clearLadderFlows: () => void
  }
  fbdFlowActions: {
    addFBDFlow: (flow: FBDFlowType) => void
    clearFBDFlows: () => void
  }
  libraryActions: { addLibrary: (name: string, type: 'function' | 'function-block') => void }
  setProjectLoading: (loading: boolean, message?: string) => void
}

/**
 * Initializes or re-initializes the project in the Zustand store.
 * Used on first load (from router) and on branch switch (without page reload).
 * Set `showLoading: false` to skip the loading overlay (e.g. on branch switch).
 */
export function initializeProject(projectData: ProjectState, actions: StoreActions, showLoading = true) {
  const {
    projectActions,
    editorActions,
    tabsActions,
    fileActions,
    ladderFlowActions,
    fbdFlowActions,
    libraryActions,
    setProjectLoading,
  } = actions

  if (showLoading) setProjectLoading(true, 'Loading project...')

  // Set the project in store
  projectActions.setProject(projectData)

  // Clear and populate flows
  ladderFlowActions.clearLadderFlows()
  fbdFlowActions.clearFBDFlows()

  // Process ladder POUs
  projectData.data.pous
    .filter((pou: PLCPou) => pou.body.language === 'ld')
    .forEach((pou: PLCPou) => {
      if (pou.body.language === 'ld') {
        const flow = pou.body.value as Record<string, unknown>
        const normalizedFlow = normalizeLadderFlow(flow, pou.name)
        ladderFlowActions.addLadderFlow(normalizedFlow)
      }
    })

  // Process FBD POUs
  projectData.data.pous
    .filter((pou: PLCPou) => pou.body.language === 'fbd')
    .forEach((pou: PLCPou) => {
      if (pou.body.language === 'fbd') {
        const flow = pou.body.value as FBDFlowType
        fbdFlowActions.addFBDFlow(flow)
      }
    })

  // Populate user libraries (functions and function-blocks)
  projectData.data.pous.forEach((pou: PLCPou) => {
    if (pou.pouType !== 'program') {
      libraryActions.addLibrary(pou.name, pou.pouType)
    }
  })

  // Set up file entries with cleanState snapshots
  const files: Record<string, FileSliceData> = {}
  projectData.data.pous.forEach((pou: PLCPou) => {
    const pouCleanState: Record<string, unknown> = {
      pou: structuredClone(pou),
    }
    if (pou.body.language === 'ld') {
      pouCleanState.ladderFlow = structuredClone(pou.body.value)
    }
    if (pou.body.language === 'fbd') {
      pouCleanState.fbdFlow = structuredClone(pou.body.value)
    }
    files[pou.name] = {
      type: pou.pouType,
      filePath: `/data/pous/${pou.pouType}/${pou.name}`,
      saved: true,
      cleanState: pouCleanState,
    }
  })
  projectData.data.dataTypes.forEach((datatype) => {
    files[datatype.name] = {
      type: 'data-type',
      filePath: `/project.json`,
      saved: true,
      cleanState: structuredClone(datatype),
    }
  })
  if (projectData.data.remoteDevices) {
    projectData.data.remoteDevices.forEach((remoteDevice) => {
      files[remoteDevice.name] = {
        type: 'remote-device',
        filePath: `/devices/remote/${remoteDevice.name}.json`,
        saved: true,
        cleanState: structuredClone(remoteDevice),
      }
    })
  }
  if (projectData.data.servers) {
    projectData.data.servers.forEach((server) => {
      files[server.name] = {
        type: 'server',
        filePath: `/servers/${server.name}.json`,
        saved: true,
        cleanState: structuredClone(server),
      }
    })
  }
  files['Resource'] = {
    type: 'resource',
    filePath: `/project.json`,
    saved: true,
    cleanState: structuredClone(projectData.data.configurations.resource),
  }
  files['Configuration'] = {
    type: 'device',
    filePath: `/device`,
    saved: true,
  }
  fileActions.setFiles({ files })

  // Clear existing tabs and editors
  tabsActions.clearTabs()
  editorActions.clearEditor()

  // Open main POU or first program
  if (projectData.data.pous.length > 0) {
    const mainPou = projectData.data.pous.find((pou: PLCPou) => pou.name === 'main' && pou.pouType === 'program')
    const pouToOpen = mainPou || projectData.data.pous.find((pou: PLCPou) => pou.pouType === 'program')

    if (pouToOpen) {
      const tabToBeCreated: TabsProps = {
        name: pouToOpen.name,
        path: `/pous/programs/${pouToOpen.name}`,
        elementType: {
          type: 'program',
          language: pouToOpen.body.language.toLowerCase() as 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp',
        },
      }
      const model = CreateEditorObjectFromTab(tabToBeCreated)
      editorActions.addModel(model)
      editorActions.setEditor(model)
      tabsActions.updateTabs(tabToBeCreated)
    }
  }

  if (showLoading) setProjectLoading(false)
}
