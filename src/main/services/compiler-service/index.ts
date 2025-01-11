import type { ChildProcessWithoutNullStreams } from 'child_process'
import { spawn } from 'child_process'
import { dialog, type MessagePortMain } from 'electron'
import { access, constants, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

import { CreateXMLFile } from '../../../main/utils'
import { ProjectState } from '../../../renderer/store/slices'
import { BufferToStringArray } from '../../../utils'
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

  buildXmlFile: async (
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

  createXmlFile: async (
    pathToUserProject: string,
    dataToCreateXml: ProjectState['data'],
  ): Promise<{ success: boolean; message: string }> => {
    const { filePath } = await dialog.showSaveDialog({
      title: 'Export Project',
      defaultPath: join(pathToUserProject, 'plc.xml'),
      buttonLabel: 'Save',
      filters: [{ name: 'XML Files', extensions: ['xml'] }],
    })

    if (!filePath) {
      return { success: false, message: 'User canceled the save dialog' }
    }

    console.log('dataToCreateXml', dataToCreateXml)

    const { data: projectDataAsString, message } = XmlGenerator(dataToCreateXml)
    if (!projectDataAsString) {
      return { success: false, message: message }
    }

    const result = CreateXMLFile(filePath, projectDataAsString, 'plc')
    try {
      await writeFile(filePath, projectDataAsString)
      console.log('File written successfully to:', filePath)
    } catch (err) {
      console.error('Error writing file:', err)
    }

    return {
      success: result.success,
      message: result.success ? ` XML file created successfully at ${filePath}` : 'Failed to create XML file',
    }
  },
  /**
   * TODO: Update the script path to use the builded version of the compiler.(Windows and MacOS)
   * TODO: Resolve the compilation for the Linux environments.
   */
  compileSTProgram: (pathToProjectFile: string, mainProcessPort: MessagePortMain): void => {
    const isDevelopment = process.env.NODE_ENV === 'development'
    const isWindows = process.platform === 'win32'
    const isMac = process.platform === 'darwin'
    const isLinux = process.platform === 'linux'

    const workingDirectory = process.cwd()

    const windowsCompilerPath = join(
      isDevelopment ? workingDirectory : process.resourcesPath,
      isDevelopment ? 'resources' : '',
      'compilers',
      'Windows',
      'xml2st',
      'xml2st.exe',
    )
    const darwinCompilerPath = join(
      isDevelopment ? workingDirectory : process.resourcesPath,
      isDevelopment ? 'resources' : '',
      'compilers',
      'MacOS',
      'xml2st',
      'xml2st',
    )
    const linuxCompilerPath = join(
      isDevelopment ? workingDirectory : process.resourcesPath,
      isDevelopment ? 'resources' : '',
      'compilers',
      'Linux',
      'xml2st',
      'xml2st.py',
    )

    const draftPath = pathToProjectFile.replace('project.json', '')
    const pathToXMLFile = join(draftPath, 'build', 'plc.xml')

    let execCompilerScript

    if (isWindows) {
      execCompilerScript = spawn(windowsCompilerPath, [pathToXMLFile])
    } else if (isMac) {
      execCompilerScript = spawn(darwinCompilerPath, [pathToXMLFile])
    } else if (isLinux) {
      execCompilerScript = spawn('python3', [linuxCompilerPath, pathToXMLFile])
    }

    execCompilerScript?.stdout.on('data', (data: Buffer) => {
      mainProcessPort.postMessage({ type: 'default', data: data })
    })

    execCompilerScript?.stderr.on('data', (data: Buffer) => {
      mainProcessPort.postMessage({ type: 'error', data: data })
      mainProcessPort.close()
    })

    execCompilerScript?.on('close', () => {
      mainProcessPort.postMessage({ type: 'info', message: 'Script finished' })
      console.log('Finished the compilation process!')
      mainProcessPort.close()
    })
  },

  /**
   * Function that handles the compilation process of a ST program into C files.
   * @param pathToStProgram
   */
  generateCFiles: (pathToStProgram: string, _mainProcessPort?: MessagePortMain): void => {
    /**
     * Get the current environment and check if it's development
     */
    const isDevelopment = process.env.NODE_ENV === 'development'

    /**
     * Check the current platform to execute the correct command based on the current operating system
     */
    const isWindows = process.platform === 'win32'
    const isMac = process.platform === 'darwin'
    const isLinux = process.platform === 'linux' // Works for Fedora and Debian/Ubuntu based systems

    /**
     * Construct the path for the current working directory to be able to access the compiler
     */
    const workingDirectory = process.cwd()

    /**
     * Construct the path for the C files compiler binary based on the current environment.
     */
    const windowsCompilerPath = join(
      isDevelopment ? workingDirectory : process.resourcesPath,
      isDevelopment ? 'resources' : '',
      'compilers',
      'Windows',
      'iec2c',
      'bin',
      'iec2c.exe',
    )
    const darwinCompilerPath = join(
      isDevelopment ? workingDirectory : process.resourcesPath,
      isDevelopment ? 'resources' : '',
      'compilers',
      'MacOS',
      'iec2c',
      'bin',
      'iec2c_mac',
    )
    const linuxCompilerPath = join(
      isDevelopment ? workingDirectory : process.resourcesPath,
      isDevelopment ? 'resources' : '',
      'compilers',
      'Linux',
      'iec2c',
      'bin',
      'iec2c',
    )

    /**
     * Create a variable to execute the C files compiler script, will receive the child_process.spawn object.
     */
    let execCompilerScript: ChildProcessWithoutNullStreams | undefined

    /**
     * Modify the cwd and pass the config files to the compiler, then execute the C files compiler script with the path to the st program file, based on the environment and OS.
     */
    if (isWindows) {
      const workingDirectoryForCompiler = windowsCompilerPath.replace('Windows/iec2c/bin/iec2c.exe', 'MatIEC')
      execCompilerScript = spawn(windowsCompilerPath, ['-f', '-l', '-p', pathToStProgram], {
        cwd: workingDirectoryForCompiler,
      })
    } else if (isMac) {
      const workingDirectoryForCompiler = darwinCompilerPath.replace('MacOS/iec2c/bin/iec2c_mac', 'MatIEC')
      execCompilerScript = spawn(darwinCompilerPath, ['-f', '-l', '-p', pathToStProgram], {
        cwd: workingDirectoryForCompiler,
      })
    } else if (isLinux) {
      const workingDirectoryForCompiler = linuxCompilerPath.replace('Linux/iec2c/bin/iec2c', 'MatIEC')
      execCompilerScript = spawn(linuxCompilerPath, ['-f', '-l', '-p', pathToStProgram], {
        cwd: workingDirectoryForCompiler,
      })
    }

    console.log('Executing C files compilation...')
    /**
     * The data object is a buffer with the content of the script output.
     * Uses ASCII code to convert the buffer to a string.
     * End of lines are separated by \r and \n characters. The ASCII code for \r is 13 and \n is 10.
     */
    execCompilerScript?.stdout.on('data', (data: Buffer) => {
      BufferToStringArray(data).forEach((line) => {
        console.log(line)
      })
      // mainProcessPort.postMessage({ type: 'default', data: data })
    })

    execCompilerScript?.stderr.on('data', (data: Buffer) => {
      BufferToStringArray(data).forEach((line) => {
        console.log(line)
      })
      // mainProcessPort.postMessage({ type: 'error', data: data })
      // !! Watch for possible bugs with this implementation. !!
      // mainProcessPort.close()
    })

    execCompilerScript?.on('close', () => {
      console.log('Finished the compilation process!')
      // mainProcessPort.postMessage({ type: 'info', message: 'Script finished' })
      // mainProcessPort.close()
    })
  },
  /**
   * This function will be responsible for call all other functions to handle the compilation process using the Arduino-CLI.
   * @todo implement the Arduino-CLI compilation process.
   */
  useArduinoCLI: () => {
    console.log('Arduino-CLI compilation process')
  },
}

export { CompilerService }
