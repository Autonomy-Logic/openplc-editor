import { useEffect, useState } from 'react'

import {
  useAccelerator,
  useCapabilities,
  useCompiler,
  useProject,
  useTheme,
  useWindow,
} from '../../../middleware/shared/providers'
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
    deviceDefinitions,
    workspace: { editingState, systemConfigs, close },
    modalActions: { openModal },
    sharedWorkspaceActions: { closeProject },
    workspaceActions: {
      switchAppTheme,
      toggleMaximizedWindow,
      setCloseWindow,
      setCloseApp,
      setCloseAppDarwin,
      setEditingState,
      setModalOpen,
      toggleCollapse,
    },
    tabsActions: { removeTab },
    fileActions: { setAllToSaved },
    pouActions: { deleteRequest: deletePouRequest },
    datatypeActions: { deleteRequest: deleteDatatypeRequest },
    snapshotActions: { undo, redo },
  } = useOpenPLCStore()
  const isMonacoFocused: boolean = useOpenPLCStore((state) => state.isMonacoFocused)
  const selectedProjectTreeLeaf = useOpenPLCStore((state) => state.workspace.selectedProjectTreeLeaf)

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
   */
  useEffect(() => {
    const unsub = accelerator.onOpenProject(() => {
      switch (editingState) {
        case 'saved':
        case 'initial-state':
          void projectPort.openProject()
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
  }, [editingState, accelerator, openModal, projectPort])

  /**
   * Open recent project (editor-specific — data passed via IPC accelerator)
   */
  useEffect(() => {
    const unsub = accelerator.onOpenRecent(() => {
      switch (editingState) {
        case 'saved':
        case 'initial-state':
          // Recent project data is passed by the adapter via IPC callback
          break
        case 'unsaved':
          openModal('save-changes-project', {
            validationContext: 'open-recent-project',
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
  }, [editingState, accelerator, openModal])

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
      setEditingState('save-request')
      projectPort
        .saveProject({
          projectPath: project.meta.path,
          projectData: project.data,
          deviceConfiguration: deviceDefinitions.configuration,
          devicePinMapping: deviceDefinitions.pinMapping.pins,
        })
        .then((res) => {
          if (res.success) {
            setEditingState('saved')
            setAllToSaved()
          } else {
            setEditingState('unsaved')
          }
        })
        .catch(() => {
          setEditingState('unsaved')
        })
    })
    return unsub
  }, [project, deviceDefinitions, accelerator, projectPort, setEditingState, setAllToSaved])

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
   * Save file (Cmd+S) — saves entire project since files are part of project XML
   */
  useEffect(() => {
    const unsub = accelerator.onSaveFile(() => {
      setEditingState('save-request')
      projectPort
        .saveProject({
          projectPath: project.meta.path,
          projectData: project.data,
          deviceConfiguration: deviceDefinitions.configuration,
          devicePinMapping: deviceDefinitions.pinMapping.pins,
        })
        .then((res) => {
          if (res.success) {
            setEditingState('saved')
            setAllToSaved()
          } else {
            setEditingState('unsaved')
          }
        })
        .catch(() => {
          setEditingState('unsaved')
        })
    })
    return unsub
  }, [selectedProjectTreeLeaf, accelerator, projectPort, project, deviceDefinitions, setEditingState, setAllToSaved])

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
   * Theme update from main process
   */
  useEffect(() => {
    const unsub = themePort.onThemeChanged(() => {
      switchAppTheme()
    })
    return unsub
  }, [themePort, switchAppTheme])

  /**
   * Window lifecycle events (editor-only, gated by capabilities)
   */
  useEffect(() => {
    if (!capabilities.hasNativeWindowControls) return

    const unsub = windowPort.enableAutoCloseHandshake?.()
    return unsub
  }, [capabilities.hasNativeWindowControls, windowPort])

  useEffect(() => {
    if (!capabilities.hasNativeWindowControls) return

    const unsub = windowPort.onCloseRequested(() => {
      setCloseWindow(true)
    })
    return unsub
  }, [capabilities.hasNativeWindowControls, windowPort, setCloseWindow])

  useEffect(() => {
    if (!capabilities.hasNativeWindowControls) return

    const unsub = windowPort.onDarwinAppQuitting?.(() => {
      setCloseAppDarwin(true)
    })
    return unsub
  }, [capabilities.hasNativeWindowControls, windowPort, setCloseAppDarwin])

  useEffect(() => {
    if (!capabilities.hasNativeWindowControls) return

    const unsub = windowPort.onMaximizedChanged?.(() => {
      toggleMaximizedWindow()
    })
    return unsub
  }, [capabilities.hasNativeWindowControls, windowPort, toggleMaximizedWindow])

  /**
   * beforeunload event (editor-only)
   */
  useEffect(() => {
    if (!capabilities.hasNativeWindowControls) return

    const handler = (e: BeforeUnloadEvent) => {
      if (process.env.NODE_ENV !== 'production') return

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
    capabilities.hasNativeWindowControls,
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
