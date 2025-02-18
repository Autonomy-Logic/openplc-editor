import type { ChildProcessWithoutNullStreams } from 'child_process'
import { exec, spawn } from 'child_process'
import { app, dialog, type MessagePortMain } from 'electron'
import { access, constants, mkdir, readFile, writeFile } from 'fs/promises'
import os from 'os'
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

class CompilerService {
  compilerDirectory: string
  runtimeResourcesPath: string
  arduinoCliBinaryPath: string
  arduinoConfigPath: string
  arduinoCliBaseParameters: string[]
  constructor() {
    this.compilerDirectory = this.constructCompilerDirectoryPath()
    this.runtimeResourcesPath = this.constructRuntimeResourcesPath()
    this.arduinoCliBinaryPath = this.constructArduinoCliBinaryPath()
    this.arduinoConfigPath = join(app.getPath('userData'), 'User', 'arduino-cli.yaml')
    this.arduinoCliBaseParameters = ['--config-file', this.arduinoConfigPath]
  }

  /**
   * Utilities functions to construct the necessary paths and folders --------------------------------------------------------------
   */
  constructCompilerDirectoryPath() {
    const isDevelopment = process.env.NODE_ENV === 'development'
    return join(isDevelopment ? process.cwd() : process.resourcesPath, isDevelopment ? 'resources' : '', 'compilers')
  }

  constructRuntimeResourcesPath() {
    const isDevelopment = process.env.NODE_ENV === 'development'
    return join(isDevelopment ? process.cwd() : process.resourcesPath, isDevelopment ? 'resources' : '', 'runtime')
  }

  constructArduinoCliBinaryPath() {
    let arduinoCliBinary: string
    switch (process.platform) {
      case 'win32':
        arduinoCliBinary = join(this.compilerDirectory, 'Windows', 'arduino-cli', 'bin', 'arduino-cli.exe')
        break
      case 'darwin':
        arduinoCliBinary = join(this.compilerDirectory, 'MacOS', 'arduino-cli', 'bin', 'arduino-cli')
        break
      case 'linux':
        arduinoCliBinary = join(this.compilerDirectory, 'Linux', 'arduino-cli', 'bin', 'arduino-cli')
        break
      default:
        throw new Error(`Unsupported platform: ${process.platform}`)
    }
    return arduinoCliBinary
  }

  async createBuildDirectoryIfNotExist(pathToUserProject: string) {
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
  }
  /**
   * End of utilities functions -----------------------------------------------------------------------------------------------------
   */

  /**
   * Setup functions  ---------------------------------------------------------------------------------------------------------------
   */

  /**
   * This function will be responsible for setting up the environment for the compiler service.
   * This will cleanup the old build files and create a new temporary build directory.
   */
  setupEnvironment() {}

  /**
   * Should look for the iec2c transpiler and the Arduino-CLI binary.
   */
  verifyPreRequisites() {}

  displayConfigInfos() {
    // Display host architecture
    const _hostArchitecture = process.arch
    // Display OS
    const _hostOS = process.platform
    // Display processor
    const _processor = process.env.PROCESSOR_IDENTIFIER
    // Display logical CPU cores
    const _logicalCPUCores = os.cpus().length
    // Display physical CPU cores
    // Display CPU frequency
    const _cpuFrequency = os.cpus()[0].speed
    // Display CPU model
    const _cpuModel = os.cpus()[0].model
    // Display iec2c version
    const _iec2cVersion = ''
    // Display Arduino version
    const _arduinoVersion = ''
  }

  /**
   * Core installation verification functions. ----------------------------------------------------------------------------------------
   */

  /**
   * Verify the core installation.
   * @param core - the core to verify if it’s installed.
   * @returns True if the core is installed, false otherwise.
   */
  checkCoreInstallation(core: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const [flag, configFile] = this.arduinoCliBaseParameters
      /**
       * Double quotes are used so that the space in the path is not interpreted as
       * a delimiter of multiple arguments.
       */
      exec(`"${this.arduinoCliBinaryPath}" core list ${flag} "${configFile}" --json`, (error, stdout, stderr) => {
        if (error) {
          return reject(error)
        }
        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          const resultAsObject = JSON.parse(stdout)
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          const installedCores = resultAsObject.platforms.map(({ id }: { id: string }) => id)
          if (stderr) {
            console.error(`Error executing command: ${stderr}`)
          }
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          const isInstalled = installedCores.includes(core) as boolean
          resolve(isInstalled)
        } catch (e) {
          reject(e)
        }
      })
    })
  }

  /**
   * Run the core update index command.
   * This command will update the core index, which contains the local cache of the available platforms and libraries.
   * TODO: Must be implemented a way to print the execution return to the user.
   */
  async runCoreUpdateIndex() {
    const arduinoCLIParams = ['core', 'update-index', ...this.arduinoCliBaseParameters]

    const arduinoCLI = spawn(this.arduinoCliBinaryPath, arduinoCLIParams)

    const binaryExecution = new Promise((resolve) => {
      let exitCode: number
      arduinoCLI.stdout.on('data', (data: Buffer) => {
        console.log(data.toString())
        exitCode = 0
      })
      arduinoCLI.stderr.on('data', (data: Buffer) => {
        console.error(data.toString())
        exitCode = 1
      })
      arduinoCLI.on('close', () => {
        console.log('Finished the arduino-cli configuration process!')
        resolve(exitCode)
      })
    })
    return binaryExecution
  }

  /**
   * Install the specified core.
   * TODO: Must be implemented a way to print the execution return to the user.
   * @param core - the core to be installed
   */
  installCore(core: string) {
    /**
     * This can be updated to not override cores that are already installed.
     */
    const arduinoCLIParams = ['core', 'install', core, ...this.arduinoCliBaseParameters]

    const arduinoCLI = spawn(this.arduinoCliBinaryPath, arduinoCLIParams)

    const binaryExecution = new Promise((resolve) => {
      let exitCode: number
      arduinoCLI.stdout.on('data', (data: Buffer) => {
        console.log(data.toString())
        exitCode = 0
      })
      arduinoCLI.stderr.on('data', (data: Buffer) => {
        console.error(data.toString())
        exitCode = 1
      })
      arduinoCLI.on('close', () => {
        console.log('Finished installing the core!')
        resolve(exitCode)
      })
    })
    return binaryExecution
  }

  /**
   * Function to update the HALS.json file which does our version controlling.
   * @param core - the core to update info.
   * @param coreVersion - the core version that was installed.
   * @param updatedAt - the date that the core was updated for last.
   */
  async updateHalsFile(_core: string, _coreVersion: string, _updatedAt: string) {
    const pathToHalsFile = join(this.runtimeResourcesPath, 'hals.json')

    const readJSONFile = async (path: string) => {
      const file = await readFile(path, 'utf8')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return JSON.parse(file) as Record<string, any>
    }

    const halsContent = await readJSONFile(pathToHalsFile)

    const cores: string[] = []
    for (const core in halsContent) {
      cores.push(core)
    }
    if (!cores.includes(_core)) return

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    halsContent[_core]['version'] = _coreVersion
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    halsContent[_core]['updatedAt'] = _updatedAt

    const updatedHalsData = JSON.stringify(halsContent)

    try {
      await writeFile(pathToHalsFile, updatedHalsData, { encoding: 'utf-8' })
      return
    } catch (err) {
      console.warn('Failed in update hals file', err)
    }
  }
  /**
   * End of core installation verification functions ---------------------------------------‰--------------------------------------------
   */

  /**
   * Board installation verification functions ------------------------------------------------------------------------------------------
   */

  /**
   * Verify if the board has an additional manager url.
   * Usually Arduino boards don't have an additional manager url.
   * If the board needs an additional manager url, we will look for this url in the arduino config file.
   * If the url is not present, we will add it to the config file.
   * @param board - the board to be verified
   * @returns
   * 0 - No additional manager url present
   * 1 - Additional manager url present
   * 2 - Error in verification process
   */
  checkForBoardAdditionalManagerUrl(_board: string) {}

  /**
   * End of board installation verification functions -----------------------------------------------------------------------------------
   */

  verifyBoardInstallation() {}

  /**
   * End of setup functions ----------------------------------------------------------------------------------------------------------
   */

  /**
   * Function to run the board installation command.
   * @todo Implement the command execution function.
   */
  configureBoard(_mainProcessPort: MessagePortMain) {
    const arduinoCLIParams = ['--no-color', 'board', 'remove', 'all']

    const arduinoCLI = spawn(this.arduinoCliBinaryPath, arduinoCLIParams)

    const binaryExecution = new Promise((resolve) => {
      let exitCode: number
      arduinoCLI.stdout.on('data', (data: Buffer) => {
        console.log(data.toString())
        exitCode = 0
      })
      arduinoCLI.stderr.on('data', (data: Buffer) => {
        console.error(data.toString())
        exitCode = 1
      })
      arduinoCLI.on('close', () => {
        console.log('Finished the arduino-cli configuration process!')
        resolve(exitCode)
      })
    })
    return binaryExecution
  }

  async buildXmlFile(
    pathToUserProject: string,
    dataToCreateXml: ProjectState['data'],
  ): Promise<{ success: boolean; message: string }> {
    const res = new Promise<{ success: boolean; message: string }>((resolve) => {
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
    })
    return res
  }

  async createXmlFile(
    pathToUserProject: string,
    dataToCreateXml: ProjectState['data'],
  ): Promise<{ success: boolean; message: string }> {
    const { filePath } = await dialog.showSaveDialog({
      title: 'Export Project',
      defaultPath: join(pathToUserProject, 'plc.xml'),
      buttonLabel: 'Save',
      filters: [{ name: 'XML Files', extensions: ['xml'] }],
    })

    if (!filePath) {
      return { success: false, message: 'User canceled the save dialog' }
    }

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
  }
  /**
   * TODO: Update the script path to use the builded version of the compiler.(Windows and MacOS)
   * TODO: Resolve the compilation for the Linux environments.
   */
  compileSTProgram(pathToProjectFile: string, mainProcessPort: MessagePortMain) {
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
  }

  /**
   * Function that handles the compilation process of a ST program into C files.
   * @param pathToStProgram
   */
  generateCFiles(pathToStProgram: string, _mainProcessPort?: MessagePortMain) {
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
  }
  /**
   * This function will be responsible for call all other functions to handle the compilation process using the Arduino-CLI.
   * @todo implement the Arduino-CLI compilation process.
   */
  useArduinoCLI() {
    console.log('Arduino-CLI compilation process')
  }
  /**
   * This function will handle the temporary directory creation and deletion.
   * The temporary directory will be used to store the files generated during the compilation process.
   * @todo Implement the temporary directory handling function.
   */
  handleTemporaryDirectory() {
    console.log('Temporary directory handling')
  }
  /**
   * This function will handle the compilation process using the Arduino-CLI.
   * @todo Implement the Arduino-CLI compilation process.
   */
  buildProject() {
    console.log('Arduino-CLI compilation process')
  }
}

export { CompilerService }
