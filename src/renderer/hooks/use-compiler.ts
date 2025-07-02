import { v4 as uuidv4 } from 'uuid'

import { useOpenPLCStore } from '../store'
import { consoleSelectors } from './use-store-selectors'

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
// WIP: This hook is not used anywhere yet, but it will be used in the future to handle the export of projects.
// It is a placeholder for now, but it will be implemented in the future.
// It is a work in progress and will be improved in the future.
const _useExportProject = async (parseTo: 'old-editor' | 'codesys') => {
  const { project } = useOpenPLCStore()
  const _addLog = consoleSelectors.useAddLog()
  const { success, message: logMessage } = await window.bridge.exportProjectXml(
    project.meta.path,
    project.data,
    parseTo,
  )
  if (success) {
    return { success: true, message: logMessage }
  }
  if (typeof logMessage === 'string') {
    return { success: false, message: logMessage }
  }
  return { success: false, message: 'An unknown error occurred.' }
}

export { useCompiler }
