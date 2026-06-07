import { useCallback, useEffect, useRef, useState } from 'react'

import {
  useAccelerator,
  useCapabilities,
  useCompiler,
  useProject,
  useTheme,
  useWindow,
} from '../../../middleware/shared/providers'
import { executeSaveActiveFile, executeSaveProject } from '../../services/save-actions'
import { useOpenPLCStore } from '../../store'
import type { ModalTypes } from '../../store/slices/modal'
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
  const accelerator = useAccelerator()
  const compilerPort = useCompiler()
  const projectPort = useProject()
  const windowPort = useWindow()
  const themePort = useTheme()
  const capabilities = useCapabilities()

  const [requestFlag, setRequestFlag] = useState(false)
  const [parseTo, setParseTo] = useState<'old-editor' | 'codesys' | null>(null)

  const {
    project,
    editor: { meta },
    workspace: { editingState, systemConfigs, close },
    modalActions: { openModal },
    sharedWorkspaceActions: { closeProject, handleOpenProjectResponse },
    workspaceActions: {
      setSystemConfigs,
      toggleMaximizedWindow,
      setCloseWindow,
      setCloseAppDarwin,
      setModalOpen,
      toggleCollapse,
    },
    tabsActions: { removeTab },
    pouActions: { deleteRequest: deletePouRequest },
    datatypeActions: { deleteRequest: deleteDatatypeRequest },
    snapshotActions: { undo, redo },
  } = useOpenPLCStore()
  const isMonacoFocused: boolean = useOpenPLCStore((state) => state.isMonacoFocused)
  const selectedProjectTreeLeaf = useOpenPLCStore((state) => state.workspace.selectedProjectTreeLeaf)
  const pendingRecentProjectRef = useRef<unknown>(null)

  const executeSave = useCallback(() => executeSaveProject(projectPort, capabilities), [projectPort, capabilities])

  /**
   * Export project accelerator
   */
  useEffect(() => {
    if (!capabilities.hasProjectExport) return

    const unsub = accelerator.onExportProject(() => {
      setRequestFlag(true)
      setParseTo('old-editor')
    })

    if (requestFlag && parseTo) {
      compilerPort
        .exportProjectXml({
          projectPath: project.meta.path,
          projectData: project.data,
          format: parseTo,
        })
        .then(() => {
          setRequestFlag(false)
          setParseTo(null)
        })
        .catch(() => {
          setRequestFlag(false)
          setParseTo(null)
        })
    }

    return unsub
  }, [requestFlag, parseTo, accelerator, compilerPort, capabilities.hasProjectExport, project])

  /**
   * Create project
   */
  useEffect(() => {
    const unsub = accelerator.onCreateProject(() => {
      if (editingState !== 'unsaved') {
        openModal('create-project', null)
      } else {
        openModal('save-changes-project', {
          validationContext: 'create-project',
        })
      }
    })
    return unsub
  }, [editingState, accelerator, openModal])

  /**
   * Open project via file picker
   *
   * Mirrors the start-screen's `handleOpenProject` flow: the picker
   * returns `{ success, data }` and the renderer must dispatch
   * `handleOpenProjectResponse(data)` to actually load the project
   * into the store.  Discarding the promise (`void
   * projectPort.openProject()`) opened the picker but threw the
   * result on the floor, so File → Open silently no-op'd after the
   * user picked a folder — only the start-screen shortcut worked.
   */
  useEffect(() => {
    const unsub = accelerator.onOpenProject(() => {
      switch (editingState) {
        case 'saved':
        case 'initial-state':
          void (async () => {
            const result = await projectPort.openProject()
            if (result.success && result.data) {
              handleOpenProjectResponse(result.data)
            }
          })()
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
    return unsub
  }, [editingState, accelerator, openModal, projectPort, handleOpenProjectResponse])

  /**
   * Open recent project (editor-specific — data passed via IPC accelerator)
   */
  useEffect(() => {
    const unsub = accelerator.onOpenRecent((projectData?: unknown) => {
      switch (editingState) {
        case 'saved':
        case 'initial-state':
          // Process immediately — data comes from the main process IPC event
          if (projectData) {
            handleOpenProjectResponse(projectData as Parameters<typeof handleOpenProjectResponse>[0])
          }
          break
        case 'unsaved':
          // Store pending data and show save modal with callback
          pendingRecentProjectRef.current = projectData ?? null
          openModal('save-changes-project', {
            validationContext: 'open-recent-project',
            onAfterAction: () => {
              const data = pendingRecentProjectRef.current
              pendingRecentProjectRef.current = null
              if (data) {
                handleOpenProjectResponse(data as Parameters<typeof handleOpenProjectResponse>[0])
              }
            },
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
    return unsub
  }, [editingState, accelerator, openModal, handleOpenProjectResponse])

  /**
   * Close project
   */
  useEffect(() => {
    const unsub = accelerator.onCloseProject(() => {
      closeProject()
    })
    return unsub
  }, [editingState, accelerator, closeProject])

  /**
   * Save project (Cmd+Shift+S)
   */
  useEffect(() => {
    const unsub = accelerator.onSaveProject(() => {
      void executeSave()
    })
    return unsub
  }, [accelerator, executeSave])

  /**
   * Delete file
   */
  useEffect(() => {
    const handleDelete = () => {
      const { label, type } = selectedProjectTreeLeaf
      if (!type || !label) {
        toast({
          title: 'Error',
          description: 'No file selected to delete.',
          variant: 'fail',
        })
        return
      }

      const isPou = ['function', 'function-block', 'program'].includes(type)
      const isDatatype = type === 'data-type'

      if (isPou) {
        deletePouRequest(label)
      } else if (isDatatype) {
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

    const unsub = accelerator.onDeleteFile(() => {
      handleDelete()
    })
    return unsub
  }, [selectedProjectTreeLeaf, accelerator, deletePouRequest, deleteDatatypeRequest])

  /**
   * Close tab
   */
  useEffect(() => {
    const unsub = accelerator.onCloseTab(() => removeTab(selectedProjectTreeLeaf.label))
    return unsub
  }, [selectedProjectTreeLeaf, accelerator, removeTab])

  /**
   * Save file (Cmd+S) — saves only the active file
   */
  useEffect(() => {
    const unsub = accelerator.onSaveFile(() => {
      void executeSaveActiveFile(projectPort, capabilities)
    })
    return unsub
  }, [accelerator, projectPort, capabilities])

  /**
   * Find in project (Cmd+Shift+F)
   */
  useEffect(() => {
    const unsub = accelerator.onFindInProject(() => {
      setModalOpen('findInProject', true)
    })
    return unsub
  }, [accelerator, setModalOpen])

  /**
   * Switch perspective (F12)
   */
  useEffect(() => {
    const unsub = accelerator.onSwitchPerspective(() => {
      toggleCollapse()
    })
    return unsub
  }, [accelerator, toggleCollapse])

  /**
   * Undo / Redo
   */
  useEffect(() => {
    const unsub = accelerator.onUndo(() => {
      if (!meta?.name) return
      undo(meta.name)
    })
    return unsub
  }, [meta.name, isMonacoFocused, accelerator, undo])

  useEffect(() => {
    const unsub = accelerator.onRedo(() => {
      if (!meta?.name) return
      redo(meta.name)
    })
    return unsub
  }, [meta.name, isMonacoFocused, accelerator, redo])

  /**
   * Quit app (Ctrl+Q on Windows/Linux)
   */
  useEffect(() => {
    const unsub = accelerator.onQuitApp(() => {
      quitAppRequest(editingState === 'unsaved', openModal)
    })
    return unsub
  }, [editingState, accelerator, openModal])

  /**
   * Theme changes (user toggle, OS preference, or cross-app cookie sync).
   * The theme adapter owns the DOM class and persistence; here we only
   * mirror the Monaco light/dark flag (set explicitly from the theme —
   * toggling drifts when cycling through the 90's skin, and the retro
   * theme uses light Monaco).
   */
  useEffect(() => {
    const unsub = themePort.onThemeChanged((newTheme) => {
      setSystemConfigs({ shouldUseDarkMode: newTheme === 'dark' })
    })
    return unsub
  }, [themePort, setSystemConfigs])

  /**
   * Window lifecycle events (editor-only, gated by capabilities)
   */
  useEffect(() => {
    if (!capabilities.isNativeApplication) return

    const unsub = windowPort.enableAutoCloseHandshake?.()
    return unsub
  }, [capabilities.isNativeApplication, windowPort])

  useEffect(() => {
    if (!capabilities.isNativeApplication) return

    const unsub = windowPort.onCloseRequested(() => {
      setCloseWindow(true)
    })
    return unsub
  }, [capabilities.isNativeApplication, windowPort, setCloseWindow])

  useEffect(() => {
    if (!capabilities.isNativeApplication) return

    const unsub = windowPort.onDarwinAppQuitting?.(() => {
      setCloseAppDarwin(true)
    })
    return unsub
  }, [capabilities.isNativeApplication, windowPort, setCloseAppDarwin])

  useEffect(() => {
    if (!capabilities.isNativeApplication) return

    const unsub = windowPort.onMaximizedChanged?.(() => {
      toggleMaximizedWindow()
    })
    return unsub
  }, [capabilities.isNativeApplication, windowPort, toggleMaximizedWindow])

  /**
   * beforeunload event (editor-only)
   */
  useEffect(() => {
    if (!capabilities.isNativeApplication) return

    const handler = (e: BeforeUnloadEvent) => {
      if (capabilities.isDevMode) return

      if (!close.window) {
        e.returnValue = false
        return
      }

      if (close.app) return

      if (systemConfigs.OS === 'darwin' && !close.appDarwin) {
        windowPort.hide()
        e.returnValue = false
        return
      }

      quitAppRequest(editingState === 'unsaved', openModal)
      e.returnValue = false
    }

    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [
    capabilities.isNativeApplication,
    close.window,
    close.app,
    close.appDarwin,
    systemConfigs.OS,
    editingState,
    openModal,
    windowPort,
  ])

  return <></>
}

export { AcceleratorHandler }
