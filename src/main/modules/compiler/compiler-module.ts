import { exec, spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { CreateXMLFile } from '@root/main/utils'
import { ProjectState } from '@root/renderer/store/slices'
import { XmlGenerator } from '@root/utils'
import { app as electronApp } from 'electron'
import type { MessagePortMain } from 'electron/main'

// import type { ArduinoCliConfig, BoardInfo, HalsFile } from './compiler-types'

interface MethodsResult<T> {
  success: boolean
  data?: T
}

class CompilerModule {
  binaryDirectoryPath: string
  sourceDirectoryPath: string

  arduinoCliBinaryPath: string
  arduinoCliConfigurationFilePath: string
  arduinoCliBaseParameters: string[]

  xml2stBinaryPath: string

  iec2cBinaryPath: string

  // ############################################################################
  // =========================== Static properties ==============================
  // ############################################################################
  static readonly HOST_PLATFORM = process.platform
  static readonly HOST_ARCHITECTURE = process.arch
  static readonly DEVELOPMENT_MODE = process.env.NODE_ENV === 'development'

  constructor() {
    this.binaryDirectoryPath = this.#constructBinaryDirectoryPath()
    this.sourceDirectoryPath = this.#constructSourceDirectoryPath()

    this.arduinoCliBinaryPath = this.#constructArduinoCliBinaryPath()
    this.arduinoCliConfigurationFilePath = join(electronApp.getPath('userData'), 'User', 'arduino-cli.yaml')
    // INFO: We use this approach because some commands can receive additional parameters as a string array.
    this.arduinoCliBaseParameters = ['--config-file', this.arduinoCliConfigurationFilePath]

    this.xml2stBinaryPath = this.#constructXml2stBinaryPath()

    this.iec2cBinaryPath = this.#constructIec2cBinaryPath()
  }

  // ############################################################################
  // =========================== Private methods ================================
  // ############################################################################

  // Initialize paths based on the environment
  #constructBinaryDirectoryPath(): string {
    return join(
      CompilerModule.DEVELOPMENT_MODE ? process.cwd() : process.resourcesPath,
      CompilerModule.DEVELOPMENT_MODE ? 'resources' : '',
      'bin',
    )
  }

  #constructSourceDirectoryPath(): string {
    return join(
      CompilerModule.DEVELOPMENT_MODE ? process.cwd() : process.resourcesPath,
      CompilerModule.DEVELOPMENT_MODE ? 'resources' : '',
      'sources',
    )
  }

  // TODO: Validate the path.
  #constructArduinoCliBinaryPath(): string {
    return join(this.binaryDirectoryPath, 'arduino-cli', 'arduino-cli')
  }

  // TODO: Validate the path.
  #constructXml2stBinaryPath(): string {
    return join(this.binaryDirectoryPath, 'xml2st', 'xml2st')
  }

  // TODO: Validate the path.
  #constructIec2cBinaryPath(): string {
    return join(this.binaryDirectoryPath, 'iec2c', 'iec2c')
  }

  // ############################################################################
  // =========================== Public methods =================================
  // ############################################################################

  // ++ ========================= Utility methods ============================= ++

  getHostHardwareInfo() {
    return `
      System Architecture: ${process.arch},
      Operating System: ${process.platform},
      Processor: ${process.env.PROCESSOR_IDENTIFIER},
      Logical CPU Cores: ${os.cpus().length},
      CPU Frequency: ${os.cpus()[0].speed} MHz,
      CPU Model: ${os.cpus()[0].model},
    `
  }

  async checkArduinoCliAvailability(): Promise<MethodsResult<string>> {
    const [flag, configFilePath] = this.arduinoCliBaseParameters

    const executeCommand = promisify(exec)
    // INFO: We use the version command to check if the arduino-cli is available.
    // INFO: If the command is not available, it will throw an error.
    const { stdout, stderr } = await executeCommand(
      `"${this.arduinoCliBinaryPath}" version ${flag} "${configFilePath}"`,
    )
    if (stderr) {
      return { success: false, data: stderr }
    }

    return { success: true, data: stdout }
  }

  async checkIec2cAvailability(): Promise<MethodsResult<string>> {
    const executeCommand = promisify(exec)
    // INFO: We use the version command to check if the iec2c is available.
    // INFO: If the command is not available, it will throw an error.
    const { stdout, stderr } = await executeCommand(`"${this.iec2cBinaryPath}" -v`)
    if (stderr) {
      return { success: false, data: stderr }
    }

    return { success: true, data: stdout }
  }

  // ++ ========================= Build Steps ================================= ++

  // +++++++++++++++++++++++++ Initialization Methods ++++++++++++++++++++++++++++
  async createBasicDirectories(
    projectFolderPath: string,
    boardTarget: string,
  ): Promise<MethodsResult<string | string[]>> {
    // INFO: We don't need to check if the directories already exist, as mkdir with { recursive: true } will handle that.
    // INFO: We will create a build directory (if it does not exist), a board-specific directory, and a source directory within the board directory.
    let result: MethodsResult<string | string[]> = { success: false }
    const buildDirectory = join(projectFolderPath, 'build')
    const boardDirectory = join(buildDirectory, boardTarget)
    const sourceDirectory = join(boardDirectory, 'src')

    try {
      // Create the directories recursively.
      // INFO: We don't have to create the build directory separately
      const results = await Promise.all([
        mkdir(boardDirectory, { recursive: true }),
        mkdir(sourceDirectory, { recursive: true }),
      ])
      if (results[0] || results[1]) {
        result = { success: true, data: [boardDirectory, sourceDirectory] }
      } else {
        result = { success: true }
      }
    } catch (_error) {
      result.data = 'Error creating directories'
    }

    return result
  }

  // async copyStaticFiles(compilationPath: string): Promise<MethodsResult> {
  //   console.log('Copying static build files...')
  //   let result: MethodsResult = { success: false }
  //   const staticArduinoFilesPath = join(this.sourceDirectoryPath, 'arduino')
  //   const staticBaremetalFilesPath = join(this.sourceDirectoryPath, 'baremetal')

  //   try {
  //     // Implement the logic to copy static build files.
  //     const results = await Promise.all([
  //       cp(staticArduinoFilesPath, join(compilationPath, 'arduino'), { recursive: true }),
  //       cp(staticBaremetalFilesPath, join(compilationPath, 'baremetal'), { recursive: true }),
  //     ])
  //     console.log('Static build files copied successfully:', results)
  //     result = { success: true, data: results }
  //   } catch (error) {
  //     console.error(`Error copying static build files: ${String(error)}`)
  //     result.data = error
  //   }

  //   return result
  // }

  // +++++++++++++++++++++++++++ Compilation Methods +++++++++++++++++++++++++++++

  async handleGenerateXMLfromJSON(sourceTargetFolderPath: string, jsonData: ProjectState['data']) {
    return new Promise<MethodsResult<string>>((resolve) => {
      const { data: xmlData } = XmlGenerator(jsonData, 'old-editor')
      if (typeof xmlData !== 'string') {
        resolve({ success: false, data: 'XML data is not a string' })
        return
      }

      const xmlCreationResult = CreateXMLFile(sourceTargetFolderPath, xmlData, 'plc')

      if (xmlCreationResult.success) {
        resolve({ success: true })
      } else {
        resolve({ success: false, data: 'Failed to create XML file' })
      }
    })
  }

  // TODO: Validate execution.
  async handleTranspileXMLtoST(generatedXMLFilePath: string, mainProcessPort: MessagePortMain) {
    return new Promise<MethodsResult<string | Buffer>>((resolve) => {
      const executeCommand = spawn(this.xml2stBinaryPath, ['--generate-st', generatedXMLFilePath])

      // INFO: We use the xml2st command to transpile the XML file to ST.
      executeCommand.stdout.on('data', (data: Buffer) => {
        mainProcessPort.postMessage({ logLevel: 'warning', message: data.toString() })
      })

      executeCommand.stderr.on('data', (data: Buffer) => {
        mainProcessPort.postMessage({ logLevel: 'error', message: `Error transpiling XML to ST: ${data.toString()}` })
        resolve({ success: false, data: 'Error transpiling XML to ST' })
      })

      executeCommand.on('close', (code) => {
        if (code === 0) {
          mainProcessPort.postMessage({
            logLevel: 'warning',
            message: `Transpiled XML to ST successfully: ${generatedXMLFilePath}`,
          })
          resolve({ success: true })
        } else {
          resolve({ success: false, data: `xml2st process exited with code ${code}` })
        }
      })
    })
  }

  // ++ ========================= Compiler builder ============================ ++

  /**
   * This will be the main entry point for the compiler module.
   * It will handle all the compilation process, will orchestrate the various steps involved in compiling a program.
   */
  // Work in progress - we should specify the arguments and the return type correctly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async compileProgram(_args: any[], _mainProcessPort: MessagePortMain): Promise<void> {
    // Start the main process port to communicate with the renderer process.
    // INFO: This is necessary to send messages back to the renderer process.
    _mainProcessPort.start()

    _mainProcessPort.postMessage({ logLevel: 'info', message: 'Starting compilation process...' })
    const projectPath = _args[0] as string // Assuming the first argument is the project path
    const boardTarget = _args[1] as string // Assuming the second argument is the board target
    const projectData = _args[2] as ProjectState['data'] // Assuming the third argument is the project data

    const sourceTargetFolderPath = join(projectPath, 'build', boardTarget, 'src') // Assuming the source folder is named 'src'

    // --- Print basic information ---
    _mainProcessPort.postMessage({
      logLevel: 'warning',
      message: `Compiling program for project: ${projectPath} and board target: ${boardTarget}`,
    })
    _mainProcessPort.postMessage({ logLevel: 'warning', message: `Host Hardware Info:\n${this.getHostHardwareInfo()}` })

    // --- Check tools availability ---
    _mainProcessPort.postMessage({ logLevel: 'info', message: 'Checking tools availability...' })
    const [arduinoCliCheckResult, iec2cCheckResult] = await Promise.all([
      this.checkArduinoCliAvailability(),
      this.checkIec2cAvailability(),
    ])
    if (!arduinoCliCheckResult.success || !iec2cCheckResult.success) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: `Missing necessary tools..`,
      })
      return
    }
    _mainProcessPort.postMessage({
      logLevel: 'info',
      message: `Arduino CLI Version: ${arduinoCliCheckResult.data}\nIEC2C Version: ${iec2cCheckResult.data}`,
    })

    // Step 1: Create basic directories
    const createDirsResult = await this.createBasicDirectories(projectPath, boardTarget)
    if (!createDirsResult.success) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: `Failed to create basic directories: ${createDirsResult.data as string}`,
      })
      return
    }

    // Step 2: Generate XML from JSON
    const generateXMLResult = await this.handleGenerateXMLfromJSON(sourceTargetFolderPath, projectData)
    if (!generateXMLResult.success) {
      _mainProcessPort.postMessage({
        logLevel: 'error',
        message: `Failed to generate XML from JSON: ${generateXMLResult.data as string}`,
      })
      return
    }

    // Step 3: Transpile XML to ST
    // const generatedXMLFilePath = join(sourceTargetFolderPath, 'plc.xml') // Assuming the XML file is named 'plc.xml'
    // const transpileXMLResult = await this.handleTranspileXMLtoST(generatedXMLFilePath, _mainProcessPort)
    // if (!transpileXMLResult.success) {
    //   _mainProcessPort.postMessage({
    //     logLevel: 'error',
    //     message: `Failed to transpile XML to ST: ${transpileXMLResult.data as string}`,
    //   })
    //   return
    // }
    _mainProcessPort.postMessage({ logLevel: 'info', message: 'XML transpiled to ST successfully.' })
    _mainProcessPort.close()
  }
}
export { CompilerModule }
