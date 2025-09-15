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
      addLog({ id: uuidv4(), level: 'warning', message: 'Attempting to generate the xml file', tstamp: new Date() })
      addLog({ id: uuidv4(), level: 'info', message: logMessage, tstamp: new Date() })
    } else {
      if (typeof logMessage === 'string') {
        addLog({ id: uuidv4(), level: 'error', message: logMessage, tstamp: new Date() })
      } else {
        addLog({ id: uuidv4(), level: 'error', message: 'An unknown error occurred.', tstamp: new Date() })
      }
    }
  }

  return { handleExportProject }
}

// ================== Compiler Handlers ==================
/**
 * This function sets up the build environment for the compiler.
 * It is a placeholder for now, but it will be implemented in the future.
 * It is a work in progress and will be improved in the future.
 * This should return a normalized response object with the status and data.
 */
const _handleSetupBuildEnvironment = () => {
  // Set up the build environment for the compiler
  // const { status, data } = window.bridge.setupBuildEnvironment()
}

/**
 * This function generates the XML and ST files for the project.
 * It is a placeholder for now, but it will be implemented in the future.
 * It is a work in progress and will be improved in the future.
 * This should return a normalized response object with the status and data.
 */
const _handleGenerateXmlAndSTFilesForBuild = () => {
  // Generate the XML and ST files for the project
  // This function will be implemented in the future
  // It is a work in progress and will be improved in the future
  // const { status, data } = window.bridge.generateXmlAndSTFilesForBuild(project.meta.path)
}

// TODO: Probably we should add a function to handle the compilation of the project.

// ================== Export Handlers ==================
// WIP: This hook is not used anywhere yet, but it will be used in the future to handle the export of projects.
// It is a placeholder for now, but it will be implemented in the future.
// It is a work in progress and will be improved in the future.
const _handleExportOpenPLCProjectToXml = (_target: 'legacy-openplc' | 'codesys') => {
  // const { project } = useOpenPLCStore()
  // TODO: We should refactor this function to use the new bridge API and return a normalized response object.
  // const { success, message: logMessage } = await window.bridge.exportProjectXml(
  //   project.meta.path,
  //   project.data,
  //   target,
  // )
  // if (success) {
  //   return { success: true, message: logMessage }
  // }
  // if (typeof logMessage === 'string') {
  //   return { success: false, message: logMessage }
  // }
  return { success: false, message: 'An unknown error occurred.' }
}

// ================== Utilities ==================
const _generateBuildPath = (_projectPath: string, _OS: string) => {
  // Generate the build path for the project based on the OS
  // We'll don't need to use it in the future, but it is a placeholder for now
  return _OS === 'win32'
    ? _projectPath.replace('\\project.json', '\\build\\program.st')
    : _projectPath.replace('/project.json', '/build/program.st')
}
export { useCompiler }
