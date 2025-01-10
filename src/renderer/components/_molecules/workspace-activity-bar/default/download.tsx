import { DownloadIcon } from '@root/renderer/assets'
import { ActivityBarButton } from '@root/renderer/components/_atoms/buttons'
import { useOpenPLCStore } from '@root/renderer/store'
import { BufferToStringArray } from '@root/utils'
import { v4 as uuidv4 } from 'uuid'
type CompileResponseObject = {
  type: 'info' | 'warning' | 'error'
  data?: Buffer
  message?: string
}

const DownloadButton = () => {
  const {
    project,
    consoleActions: { addLog },
    workspace: {
      systemConfigs: { OS },
    },
  } = useOpenPLCStore()

  const buildProgram = () =>
    window.bridge.compileRequest(project.meta.path, (compileResponse: CompileResponseObject) => {
      const { type: stdType, data, message: stdMessage } = compileResponse
      const uint8Array = data
      if (!uint8Array) return
      const lines = BufferToStringArray(uint8Array)
      lines.forEach((line, index) => {
        addLog({ id: uuidv4(), type: stdType, message: line })
        if (index === lines.length - 2) {
          const buildPath = `${OS === 'win32' ? project.meta.path.replace('\\project.json', '\\build\\program.st') : project.meta.path.replace('/project.json', '/build/program.st')}`
          lines[index].includes('successfully') &&
            addLog({ id: uuidv4(), type: 'info', message: `OpenPLC Runtime program generated at ${buildPath}` })
        }
      })
      stdMessage && addLog({ id: uuidv4(), type: stdType, message: stdMessage })
    })

  const requestBuildProgram = async () => {
    addLog({ id: uuidv4(), type: 'info', message: 'Build process started' })
    addLog({ id: uuidv4(), type: 'warning', message: 'Verifying if build directory exist' })
    const { success, message: logMessage } = await window.bridge.createBuildDirectory(project.meta.path)
    if (success) {
      addLog({ id: uuidv4(), type: 'info', message: logMessage })
      addLog({ id: uuidv4(), type: 'warning', message: 'Attempting to generate the xml file' })
      const result = await window.bridge.createXmlFileToBuild(project.meta.path, project.data)
      if (result.success) {
        addLog({ id: uuidv4(), type: 'info', message: result.message })
        addLog({ id: uuidv4(), type: 'warning', message: 'Attempting to build the program' })
        // !! REFACTOR THIS PART !!
        // This function call the compiler service to build the xml file into a program object.
        // This process need to be improved to handle the response and call the next stages in the compilation process.
        buildProgram()
        // !! REFACTOR THIS PART !!
        // This implementation is not correct, the build process should be handled by the compiler service and the function call should be handled by the bridge.
        // setTimeout(() => window.bridge.generateCFilesRequest(buildPath), 3000)
      } else {
        addLog({ id: uuidv4(), type: 'error', message: result.message })
        if (result.message.includes('Main POU not found')) {
          addLog({ id: uuidv4(), type: 'error', message: 'The project must have a "main" program pou.' })
        }
      }
    } else {
      addLog({ id: uuidv4(), type: 'error', message: logMessage })
    }
  }

  return (
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    <ActivityBarButton aria-label='Download' onClick={requestBuildProgram}>
      <DownloadIcon />
    </ActivityBarButton>
  )
}

export { DownloadButton }
