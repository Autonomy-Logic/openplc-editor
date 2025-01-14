import { IProjectServiceResponse } from '@root/main/services'
import { useCompiler } from '@root/renderer/hooks'
import { useOpenPLCStore } from '@root/renderer/store'
import { useEffect, useState } from 'react'

const AcceleratorHandler = () => {
  const { handleExportProject } = useCompiler()
  const [requestFlag, setRequestFlag] = useState(false)
  const {
    modalActions: { openModal },
    workspace: { editingState },
    sharedWorkspaceActions: { closeProject, openProject, openRecentProject },
  } = useOpenPLCStore()

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
   * -- Quit app
   */
  useEffect(() => {
    window.bridge.quitAppRequest(() => {
      if (editingState === 'unsaved') {
        openModal('save-changes-project', 'close-app')
      } else {
        window.bridge.closeWindow()
      }
    })
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

  return <></>
}
export { AcceleratorHandler }
