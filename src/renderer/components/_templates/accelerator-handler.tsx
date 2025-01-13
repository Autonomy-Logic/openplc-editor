import { useCompiler } from '@root/renderer/hooks'
import { useOpenPLCStore } from '@root/renderer/store'
import { useEffect, useState } from 'react'

const AcceleratorHandler = () => {
  const { handleExportProject } = useCompiler()
  const [requestFlag, setRequestFlag] = useState(false)
  const {
    modalActions: { openModal },
    workspace: { editingState },
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

  useEffect(() => {
    window.bridge.closeProjectAccelerator((_event) => {
      if (editingState === 'unsaved') {
        openModal('save-changes-project', 'close-project')
      }
    })

    return () => {
      window.bridge.removeCloseProjectListener()
    }
  }, [editingState])

  return <></>
}
export { AcceleratorHandler }
