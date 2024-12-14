import { spawn } from 'child_process'
import type { MessagePortMain } from 'electron'
import { access, constants, mkdir } from 'fs/promises'
import { join } from 'path'

import { CreateXMLFile } from '../../../main/utils'
import { ProjectState } from '../../../renderer/store/slices'
import { XmlGenerator } from '../../../utils/PLC/xml-generator'

export type CompilerResponse = {
  error?: boolean
  message: {
    type: 'error' | 'warning' | 'info'
    content: string | Buffer
  }
}

const CompilerService = {
  createBuildDirectoryIfNotExist: async (pathToUserProject: string) => {
    const normalizedUserProjectPath = pathToUserProject.replace('project.json', '')
    const pathToBuildDirectory = join(normalizedUserProjectPath, 'build')
    try {
      await access(pathToBuildDirectory, constants.F_OK)
      return { success: true, message: 'Directory already exists' }
    } catch {
      try {
        await mkdir(pathToBuildDirectory, { recursive: true })
        return { success: true, message: 'Directory created' }
      } catch (err) {
        // @ts-expect-error Unknown type is not being accepted.
        return { success: false, message: `Error creating directory at ${pathToBuildDirectory}: ${err.message}` }
      }
    }
  },
  createXmlFile: async (
    pathToUserProject: string,
    dataToCreateXml: ProjectState['data'],
  ): Promise<{ success: boolean; message: string }> =>
    new Promise((resolve) => {
      const normalizedUserProjectPath = pathToUserProject.replace('project.json', '')
      const pathToBuildDirectory = join(normalizedUserProjectPath, 'build')
      const { data: projectDataAsString, message } = XmlGenerator(dataToCreateXml)
      if (!projectDataAsString) {
        resolve({ success: false, message: message })
        return
      }
      const result = CreateXMLFile(pathToBuildDirectory, projectDataAsString, 'plc')
      /**
       * This condition must be verified.
       * The CreateXMLFile function return should be validated.
       * ```It is possible that the success property is always true```
       */
      if (result.success) {
        resolve({ success: result.success, message: result.message })
      } else {
        resolve({ success: result.success, message: 'Xml file not created' })
      }
    }),
  /**
   * This is a mock implementation to be used as a presentation.
   * !! Do not use this on production !!
   */
  compileSTProgram: (pathToProjectFile: string, mainProcessPort: MessagePortMain): void => {
    // Get the current environment and check if it's development
    const isDevelopment = process.env.NODE_ENV === 'development'

    // Check if the current platform is Windows to execute the correct command based on the current operating system
    const isWindows = process.platform === 'win32'

    // Construct the path for the current working directory to be able to access the compiler
    const workingDirectory = process.cwd()

    // Construct the path for the st compiler script based on the current environment
    const windowsCompilerPath = isDevelopment
      ? join(workingDirectory, 'resources', 'st-compiler', 'xml2st.py')
      : join(process.resourcesPath, 'assets', 'st-compiler', 'xml2st.exe')
    const unixCompilerPath = isDevelopment
      ? join(workingDirectory, 'resources', 'st-compiler', 'xml2st.py')
      : join(process.resourcesPath, 'assets', 'st-compiler', 'xml2st.py') // TODO: This must be modified to match the correct OS extension

    // Remove the project.json file from the path to the xml file.
    // This is necessary because on windows the path is handled differently from unix systems
    const draftPath = pathToProjectFile.replace('project.json', '')

    // Construct the path to the xml file
    const pathToXMLFile = join(draftPath, 'build', 'plc.xml')

    // Execute the st compiler script with the path to the xml file.
    // CAUTION!!!!
    // TODO: This only works on development environment. Need to be added the path for the production environment
    const windowsCommand = isDevelopment
      ? spawn('py', [windowsCompilerPath, pathToXMLFile])
      : spawn(windowsCompilerPath, [pathToXMLFile])
    const unixCommand = isDevelopment
      ? spawn('python3', [unixCompilerPath, pathToXMLFile])
      : spawn(unixCompilerPath, [pathToXMLFile])

    const execCompilerScript = isWindows ? windowsCommand : unixCommand

    /**
     * The data object is a buffer with the content of the script output.
     * Uses ASCII code to convert the buffer to a string.
     * End of lines are separated by \r and \n characters. The ASCII code for \r is 13 and \n is 10.
     */
    execCompilerScript.stdout.on('data', (data: Buffer) => {
      mainProcessPort.postMessage({ type: 'default', data: data })
    })

    execCompilerScript.stderr.on('data', (data: Buffer) => {
      mainProcessPort.postMessage({ type: 'error', data: data })
      // !! Watch for possible bugs with this implementation. !!
      mainProcessPort.close()
    })

    execCompilerScript.on('close', () => {
      mainProcessPort.postMessage({ type: 'info', message: 'Script finished' })
      mainProcessPort.close()
    })
  },
}

export { CompilerService }
