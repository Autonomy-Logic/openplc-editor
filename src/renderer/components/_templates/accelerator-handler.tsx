import { IProjectServiceResponse } from '@root/main/services'
import { useCompiler } from '@root/renderer/hooks'
import { useQuitApp } from '@root/renderer/hooks/use-quit-app'
import { useOpenPLCStore } from '@root/renderer/store'
import { useEffect, useState } from 'react'

const AcceleratorHandler = () => {
  const { handleExportProject } = useCompiler()
  const [requestFlag, setRequestFlag] = useState(false)
  const {
    workspace: { editingState, closeApp, closeWindow, systemConfigs },
    modalActions: { openModal },
    sharedWorkspaceActions: { closeProject, openProject, openRecentProject },
    workspaceActions: { switchAppTheme, toggleMaximizedWindow },
  } = useOpenPLCStore()

  const { handleWindowClose, handleAppIsClosing } = useQuitApp()

  const quitAppRequest = () => {
    if (editingState === 'unsaved') {
      openModal('save-changes-project', 'close-app')
      return
    }
    openModal('quit-application', null)
  }

  /**
   * Compiler Related Accelerators
   */
  useEffect(() => {
    window.bridge.exportProjectRequest((_event) => setRequestFlag(true))
    requestFlag &&
      handleExportProject()
        .then(() => setRequestFlag(false))
        .catch(() => setRequestFlag(false))
    return () => {
      window.bridge.removeExportProjectListener()
    }
  }, [requestFlag])

  /**
   * Window Related Accelerators
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
    window.bridge.quitAppRequest(() => quitAppRequest())
    return () => {
      window.bridge.removeQuitAppListener()
    }
  }, [editingState])

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
   * Application Related Accelerators
   */

  useEffect(() => {
    window.bridge.appIsClosing((_event) => {
      handleAppIsClosing()
    })
  }, [])

  /**
   * -- beforeunload event
   * This event is fired after the mainWindow (electron) close event
   */
  window.onbeforeunload = (e) => {
    // When page is reloaded, the beforeunload event is fired, so we need to prevent the default behavior
    if (!closeWindow) {
      e.returnValue = false
      return
    }

    if (closeApp) return

    if (systemConfigs.OS === 'darwin') {
      window.bridge.hideWindow()
      e.returnValue = false
      return
    }

    quitAppRequest()
    e.returnValue = false
  }

  return <></>
}
export { AcceleratorHandler }
