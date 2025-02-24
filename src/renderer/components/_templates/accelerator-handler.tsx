import type { ISaveDataResponse } from '@root/main/modules/ipc/renderer'
import type { IProjectServiceResponse } from '@root/main/services'
import { useCompiler } from '@root/renderer/hooks'
import { useQuitApp } from '@root/renderer/hooks/use-quit-app'
import { useOpenPLCStore } from '@root/renderer/store'
import type { ModalTypes, ProjectState } from '@root/renderer/store/slices'
import { PLCProjectSchema } from '@root/types/PLC/open-plc'
import { useEffect, useState } from 'react'

import { toast } from '../_features/[app]/toast/use-toast'

const quitAppRequest = (isUnsaved: boolean, openModal: (modal: ModalTypes, data?: unknown) => void) => {
  if (isUnsaved) {
    openModal('save-changes-project', 'close-app')
    return
  }
  openModal('quit-application', null)
}

export const saveProjectRequest = async (
  project: ProjectState,
  setEditingState: (state: 'saved' | 'unsaved' | 'save-request' | 'initial-state') => void,
): Promise<ISaveDataResponse> => {
  setEditingState('save-request')
  toast({
    title: 'Save changes',
    description: 'Trying to save the changes in the project file.',
    variant: 'warn',
  })

  const projectData = PLCProjectSchema.safeParse(project)
  if (!projectData.success) {
    setEditingState('unsaved')
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

  const { success, reason } = await window.bridge.saveProject({
    projectPath: project.meta.path,
    projectData: projectData.data,
  })

  if (success) {
    setEditingState('saved')
    toast({
      title: 'Changes saved!',
      description: 'The project was saved successfully!',
      variant: 'default',
    })
  } else {
    setEditingState('unsaved')
    toast({
      title: 'Error in the save request!',
      description: reason?.description,
      variant: 'fail',
    })
  }

  return { success, reason }
}

const AcceleratorHandler = () => {
  const { handleExportProject } = useCompiler()
  const [requestFlag, setRequestFlag] = useState(false)
  const {
    project,
    workspace: { editingState, systemConfigs, close },
    modalActions: { openModal },
    sharedWorkspaceActions: { closeProject, openProject, openRecentProject },
    workspaceActions: { setEditingState, switchAppTheme, toggleMaximizedWindow },
  } = useOpenPLCStore()

  const { handleWindowClose, handleAppIsClosingDarwin } = useQuitApp()

  /**
   * Compiler Related Accelerators
   */
  useEffect(() => {
    window.bridge.exportProjectRequest((_event) => setRequestFlag(true))
    if (requestFlag)
      handleExportProject()
        .then(() => setRequestFlag(false))
        .catch(() => setRequestFlag(false))
    return () => {
      window.bridge.removeExportProjectListener()
    }
  }, [requestFlag])

  /**
   * ==== Project Related Accelerators ====
   */

  /**
   * -- Create project
   */
  useEffect(() => {
    window.bridge.createProjectAccelerator((_event) => {
      if (editingState !== 'unsaved') {
        openModal('create-project', null)
      } else {
        openModal('save-changes-project', 'create-project')
      }
    })

    return () => {
      window.bridge.removeCreateProjectAccelerator()
    }
  }, [editingState])

  /**
   * -- Open project
   */
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    window.bridge.handleOpenProjectRequest(async (_event) => {
      if (editingState === 'initial-state') {
        await openProject()
        return
      }
      if (editingState === 'unsaved') {
        openModal('save-changes-project', 'open-project')
      }
    })

    return () => {
      window.bridge.removeOpenProjectAccelerator()
    }
  }, [editingState])

  /**
   * -- Open project by path project
   */
  useEffect(() => {
    window.bridge.openRecentAccelerator((_event, response: IProjectServiceResponse) => {
      openRecentProject(response)
    })

    return () => {
      window.bridge.removeOpenRecentListener()
    }
  }, [])

  /**
   * -- Close project
   */
  useEffect(() => {
    window.bridge.closeProjectAccelerator((_event) => {
      closeProject()
    })

    return () => {
      window.bridge.removeCloseProjectListener()
    }
  }, [editingState])

  /**
   * -- Save project
   */
  useEffect(() => {
    window.bridge.saveProjectAccelerator((_event) => {
      void saveProjectRequest(project, setEditingState)
    })

    return () => {
      window.bridge.removeSaveProjectAccelerator()
    }
  }, [project])

  /**
   * ==== Window Related Accelerators ====
   */

  /**
   * -- Request close app window
   */
  useEffect(() => {
    window.bridge.handleCloseOrHideWindowAccelerator()
    return () => {
      window.bridge.removeHandleCloseOrHideWindowAccelerator()
    }
  }, [])

  /**
   * -- Quit app
   */
  useEffect(() => {
    window.bridge.quitAppRequest(() => quitAppRequest(editingState === 'unsaved', openModal))
    return () => {
      window.bridge.removeQuitAppListener()
    }
  }, [editingState])

  /**
   * -- Toggle maximized window
   */
  useEffect(() => {
    window.bridge.isMaximizedWindow((_event) => {
      toggleMaximizedWindow()
    })
  }, [])

  /**
   * -- Update theme
   */
  useEffect(() => {
    window.bridge.handleUpdateTheme((_event) => {
      switchAppTheme()
    })
  }, [])

  /**
   * -- Windows is closing?
   */
  useEffect(() => {
    window.bridge.windowIsClosing((_event) => {
      handleWindowClose()
    })
  }, [])

  /**
   * -- Quit app in darwin.
   * The flow is: before-quit -> close -> beforeunload -> closed -> will-quit -> quit
   */
  useEffect(() => {
    window.bridge.darwinAppIsClosing(() => {
      handleAppIsClosingDarwin()
    })
  }, [])

  /**
   * -- beforeunload event
   * This event is fired after the mainWindow (electron) close event
   */
  window.onbeforeunload = (e) => {
    // When page is reloaded, the beforeunload event is fired, so we need to prevent the default behavior
    if (process.env.NODE_ENV !== 'production') {
      return
    }

    if (!close.window) {
      e.returnValue = false
      return
    }

    if (close.app) return

    if (systemConfigs.OS === 'darwin' && !close.appDarwin) {
      window.bridge.hideWindow()
      e.returnValue = false
      return
    }

    quitAppRequest(editingState === 'unsaved', openModal)
    e.returnValue = false
  }

  return <></>
}

export { AcceleratorHandler }
