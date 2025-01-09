import { spawn } from 'child_process'
import type { MessagePortMain } from 'electron'
import { access, constants, mkdir } from 'fs/promises'
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
   * TODO: Update the script path to use the builded version of the compiler.(Windows and MacOS)
   * TODO: Resolve the compilation for the Linux environments.
   */
  compileSTProgram: (pathToProjectFile: string, mainProcessPort: MessagePortMain): void => {
    // Get the current environment and check if it's development
    const isDevelopment = process.env.NODE_ENV === 'development'

    // Check the current platform to execute the correct command based on the current operating system
    const isWindows = process.platform === 'win32'
    const isMac = process.platform === 'darwin'
    const isLinux = process.platform === 'linux' // Works for Fedora and Debian/Ubuntu based systems

    // Construct the path for the current working directory to be able to access the compiler
    const workingDirectory = process.cwd()

    const developmentCompilerPath = join(workingDirectory, 'resources', 'st-compiler', 'xml2st.py')
    // Construct the path for the st compiler script based on the current environment
    const windowsCompilerPath = join(process.resourcesPath, 'assets', 'st-compiler', 'xml2st.exe')
    const darwinCompilerPath = join(process.resourcesPath, 'assets', 'st-compiler', 'xml2st')
    const linuxCompilerPath = join(process.resourcesPath, 'assets', 'st-compiler', 'xml2st.py')

    // Remove the project.json file from the path to the xml file.
    // This is necessary because on windows the path is handled differently from unix systems
    const draftPath = pathToProjectFile.replace('project.json', '')

    // Construct the path to the xml file
    const pathToXMLFile = join(draftPath, 'build', 'plc.xml')

    // Create a variable to execute the st compiler script
    let execCompilerScript

    // Execute the st compiler script with the path to the xml file, based on the environment and OS.
    if (isDevelopment) {
      if (isWindows) {
        execCompilerScript = spawn('py', [developmentCompilerPath, pathToXMLFile])
      } else if (isMac || isLinux) {
        execCompilerScript = spawn('python3', [developmentCompilerPath, pathToXMLFile])
      }
    } else {
      if (isWindows) {
        execCompilerScript = spawn(windowsCompilerPath, [pathToXMLFile])
      } else if (isMac) {
        execCompilerScript = spawn(darwinCompilerPath, [pathToXMLFile])
      } else if (isLinux) {
        execCompilerScript = spawn('python3', [linuxCompilerPath, pathToXMLFile])
      }
    }

    /**
     * The data object is a buffer with the content of the script output.
     * Uses ASCII code to convert the buffer to a string.
     * End of lines are separated by \r and \n characters. The ASCII code for \r is 13 and \n is 10.
     */
    execCompilerScript?.stdout.on('data', (data: Buffer) => {
      mainProcessPort.postMessage({ type: 'default', data: data })
    })

    execCompilerScript?.stderr.on('data', (data: Buffer) => {
      mainProcessPort.postMessage({ type: 'error', data: data })
      // !! Watch for possible bugs with this implementation. !!
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
    // const draftPath = pathToProjectFile.replace('project.json', '')
    // Construct the path to the xml file
    // const pathToStProgram = join(draftPath, 'build', 'program.st')
    // Get the current environment and check if it's development
    const isDevelopment = process.env.NODE_ENV === 'development'

    // Check the current platform to execute the correct command based on the current operating system
    const _isWindows = process.platform === 'win32'
    const _isMac = process.platform === 'darwin'
    const _isLinux = process.platform === 'linux' // Works for Fedora and Debian/Ubuntu based systems

    // Construct the path for the current working directory to be able to access the compiler
    const workingDirectory = process.cwd()

    // Construct the path for the C files compiler binary based on the current environment
    const _windowsCompilerPath = join(
      isDevelopment ? workingDirectory : process.resourcesPath,
      isDevelopment ? 'resources' : '',
      'compilers',
      'Windows',
      'iec2c',
      'bin',
      'iec2c.exe',
    )
    const darwinCompilerPath = join(workingDirectory, 'resources', 'compilers', 'MacOS', 'iec2c', 'bin', 'iec2c_mac')
    const _linuxCompilerPath = join(
      isDevelopment ? workingDirectory : process.resourcesPath,
      isDevelopment ? 'resources' : '',
      'compilers',
      'Linux',
      'iec2c',
      'bin',
      'iec2c',
    )
    /**
     * Modify the cwd and pass the config files to the compiler.
     */
    console.log('Path ->', process.cwd())

    // let execCompilerScript
    // // Execute the C files compiler script with the path to the st program file, based on the environment and OS.
    // if (isWindows) {
    //   execCompilerScript = spawn(windowsCompilerPath, ['-f', '-l', '-p', pathToStProgram])
    // } else if (isMac) {
    //   execCompilerScript = spawn(darwinCompilerPath, ['-f', '-l', '-p', pathToStProgram])
    // } else if (isLinux) {
    //   execCompilerScript = spawn(linuxCompilerPath, ['-f', '-l', '-p', pathToStProgram])
    // }

    console.log('Executing C files compilation...')
    /**
     * The data object is a buffer with the content of the script output.
     * Uses ASCII code to convert the buffer to a string.
     * End of lines are separated by \r and \n characters. The ASCII code for \r is 13 and \n is 10.
     */
    spawn(darwinCompilerPath, ['-f', '-l', '-p', pathToStProgram])?.stdout.on('data', (data: Buffer) => {
      BufferToStringArray(data).forEach((line) => {
        console.log(line)
      })
      // mainProcessPort.postMessage({ type: 'default', data: data })
    })

    spawn(darwinCompilerPath, ['-f', '-l', '-p', pathToStProgram])?.stderr.on('data', (data: Buffer) => {
      BufferToStringArray(data).forEach((line) => {
        console.log(line)
      })
      // mainProcessPort.postMessage({ type: 'error', data: data })
      // !! Watch for possible bugs with this implementation. !!
      // mainProcessPort.close()
    })

    spawn(darwinCompilerPath, ['-f', '-l', '-p', pathToStProgram])?.on('close', () => {
      console.log('Finished the compilation process!')
      // mainProcessPort.postMessage({ type: 'info', message: 'Script finished' })
      // mainProcessPort.close()
    })
  },
}

export { CompilerService }
