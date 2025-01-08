import { v4 as uuidv4 } from 'uuid'

import { useOpenPLCStore } from '../store'

const useCompiler = () => {
  const {
    project,
    consoleActions: { addLog },
    workspace: {
      systemConfigs: { OS },
    },
  } = useOpenPLCStore()

  const handleExportProject = async () => {
    addLog({ id: uuidv4(), type: 'warning', message: 'Verifying if build directory exists' })

    // Primeira chamada para exportar o projeto
    const { success, message: logMessage } = await window.bridge.exportProjectXml(project.meta.path, project.data)

    if (success) {
      addLog({ id: uuidv4(), type: 'info', message: logMessage })

      // Em vez de chamar `createXmlFileToBuild` aqui, vamos chamar diretamente o método do backend
      addLog({ id: uuidv4(), type: 'warning', message: 'Attempting to generate the xml file' })
      const result = await window.bridge.createXmlFileToBuild(project.meta.path, project.data)

      if (result.success) {
        addLog({ id: uuidv4(), type: 'info', message: result.message })
        const buildPath = `${OS === 'win32' ? project.meta.path.replace('\\project.json', '\\build\\plc.xml') : project.meta.path.replace('/project.json', '/build/plc.xml')}`
        addLog({ id: uuidv4(), type: 'info', message: `PLC Open XML file generated at ${buildPath}` })
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
