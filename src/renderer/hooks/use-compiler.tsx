import { v4 as uuidv4 } from 'uuid'

import { useOpenPLCStore } from '../store'

const useCompiler = () => {
  const {
    project,
    consoleActions: { addLog },
  } = useOpenPLCStore()

  const handleExportProject = async () => {
    addLog({ id: uuidv4(), type: 'warning', message: 'Verifying if build directory exist' })
    const { success, message: logMessage } = await window.bridge.createBuildDirectory(project.meta.path)
    if (success) {
      addLog({ id: uuidv4(), type: 'info', message: logMessage })
      addLog({ id: uuidv4(), type: 'warning', message: 'Attempting to generate the xml file' })
      const result = await window.bridge.createXmlFileToBuild(project.meta.path, project.data)
      if (result.success) {
        addLog({ id: uuidv4(), type: 'info', message: result.message })
      } else {
        addLog({ id: uuidv4(), type: 'error', message: result.message })
      }
    } else {
      addLog({ id: uuidv4(), type: 'error', message: logMessage })
    }
  }
  return { handleExportProject }
}
export { useCompiler }
