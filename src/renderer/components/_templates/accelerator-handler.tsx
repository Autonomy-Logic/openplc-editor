import { useCompiler, workspaceSelectors } from '@root/renderer/hooks'
import { useQuitApp } from '@root/renderer/hooks/use-quit-app'
import { useOpenPLCStore } from '@root/renderer/store'
import type { ModalTypes } from '@root/renderer/store/slices'
import { IProjectServiceResponse } from '@root/types/IPC/project-service'
import { useEffect, useState } from 'react'

import { toast } from '../_features/[app]/toast/use-toast'

const quitAppRequest = (isUnsaved: boolean, openModal: (modal: ModalTypes, data?: unknown) => void) => {
  if (isUnsaved) {
    openModal('save-changes-project', {
      validationContext: 'close-app',
    })
    return
  }
  openModal('quit-application', null)
}

const AcceleratorHandler = () => {
  const { handleExportProject } = useCompiler()
  const [requestFlag, setRequestFlag] = useState(false)
  const [parseTo, setParseTo] = useState<'old-editor' | 'codesys' | null>(null)

  const {
    project,
    deviceDefinitions,
    selectedTab,
    workspace: { editingState, systemConfigs, close },
    modalActions: { openModal },
    sharedWorkspaceActions: { closeProject, openProject, openRecentProject, saveFile, saveProject, closeFileRequest },
    workspaceActions: { switchAppTheme, toggleMaximizedWindow },
    pouActions: { deleteRequest: deletePouRequest },
    datatypeActions: { deleteRequest: deleteDatatypeRequest },
  } = useOpenPLCStore()

  const { handleWindowClose, handleAppIsClosingDarwin } = useQuitApp()

  const selectedProjectLeft = workspaceSelectors.useSelectedProjectTreeLeaf()

  /**
   * Compiler Related Accelerators
   */
  useEffect(() => {
    window.bridge.exportProjectRequest((_event, value: 'old-editor' | 'codesys') => {
      setRequestFlag(true)
      setParseTo(value)
    })
    if (requestFlag && parseTo)
      handleExportProject(parseTo)
        .then(() => {
          setRequestFlag(false)
          setParseTo(null)
        })
        .catch(() => {
          setRequestFlag(false)
          setParseTo(null)
        })
    return () => {
      window.bridge.removeExportProjectListener()
    }
  }, [requestFlag, parseTo])

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
        openModal('save-changes-project', {
          validationContext: 'create-project',
        })
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
      switch (editingState) {
        case 'saved':
        case 'initial-state':
          await openProject()
          break
        case 'unsaved':
          openModal('save-changes-project', {
            validationContext: 'open-project',
          })
          break
        case 'save-request':
          toast({
            title: 'Save in progress',
            description: 'Please wait for the current save operation to complete.',
            variant: 'warn',
          })
          break
        default:
          return
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
      switch (editingState) {
        case 'saved':
        case 'initial-state':
          openRecentProject(response)
          break
        case 'unsaved':
          openModal('save-changes-project', {
            validationContext: 'open-recent-project',
            recentResponse: response,
          })
          break
        case 'save-request':
          toast({
            title: 'Save in progress',
            description: 'Please wait for the current save operation to complete.',
            variant: 'warn',
          })
          break
        default:
          return
      }
    })

    return () => {
      window.bridge.removeOpenRecentListener()
    }
  }, [editingState])

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
      void saveProject(project, deviceDefinitions)
    })

    return () => {
      window.bridge.removeSaveProjectAccelerator()
    }
  }, [project, deviceDefinitions])

  /**
   * ==== File Related Accelerators ====
   */

  /**
   * -- Delete files
   */
  useEffect(() => {
    const handleDelete = () => {
      const { label, type } = selectedProjectLeft

      if (type === 'pou') {
        deletePouRequest(label)
      } else if (type === 'datatype') {
        deleteDatatypeRequest(label)
      } else {
        toast({
          title: 'Error',
          description: 'This element cannot be deleted.',
          variant: 'fail',
        })
        return
      }
    }

    window.bridge.deleteFileAccelerator((_event) => {
      handleDelete()
    })

    return () => {
      window.bridge.removeDeleteFileListener()
    }
  }, [selectedProjectLeft])

  /**
   * -- Close tabs/editor
   */
  useEffect(() => {
    window.bridge.closeTabAccelerator((_event) => closeFileRequest(selectedTab))

    return () => {
      void window.bridge.removeCloseTabListener()
    }
  }, [selectedTab])

  /**
   * -- Save file
   */
  useEffect(() => {
    window.bridge.saveFileAccelerator((_event) => {
      if (!selectedTab) return
      void saveFile(selectedTab)
    })

    return () => {
      window.bridge.removeSaveFileAccelerator()
    }
  }, [selectedTab])

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
