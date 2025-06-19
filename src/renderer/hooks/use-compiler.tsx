import { v4 as uuidv4 } from 'uuid'

import { useOpenPLCStore } from '../store'

const useCompiler = () => {
  const {
    project,
    consoleActions: { addLog },
  } = useOpenPLCStore()

  const handleExportProject = async (parseTo: 'old-editor' | 'codesys') => {
    const { success, message: logMessage } = await window.bridge.exportProjectXml(
      project.meta.path,
      project.data,
      parseTo,
    )
    if (success) {
      addLog({ id: uuidv4(), type: 'warning', message: 'Attempting to generate the xml file' })
      addLog({ id: uuidv4(), type: 'info', message: logMessage })
    } else {
      if (typeof logMessage === 'string') {
        addLog({ id: uuidv4(), type: 'error', message: logMessage })
      } else {
        addLog({ id: uuidv4(), type: 'error', message: 'An unknown error occurred.' })
      }
    }
  }

  return { handleExportProject }
}
export { useCompiler }
