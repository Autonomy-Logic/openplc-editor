import { exec } from 'node:child_process'
import { cp, mkdir } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { app as electronApp } from 'electron'

// import type { ArduinoCliConfig, BoardInfo, HalsFile } from './compiler-types'

interface MethodsResult {
  success: boolean
  data?: unknown
}

class CompilerModule {
  binaryDirectoryPath: string
  sourceDirectoryPath: string

  arduinoCliBinaryPath: string
  arduinoCliConfigurationFilePath: string
  arduinoCliBaseParameters: string[]

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
    // INFO: We use this approach because some commands can receive additional parameters as a string arrayÍ.
    this.arduinoCliBaseParameters = ['--config-file', this.arduinoCliConfigurationFilePath]

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

  async checkArduinoCliAvailability(): Promise<MethodsResult> {
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

  async checkIec2cAvailability(): Promise<MethodsResult> {
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
  async createBasicDirectories(projectFolderPath: string, boardTarget: string): Promise<MethodsResult> {
    // INFO: We don't need to check if the directories already exist, as mkdir with { recursive: true } will handle that.
    // INFO: We will create a build directory (if it does not exist), a board-specific directory, and a source directory within the board directory.
    console.log('Creating directories for project:', projectFolderPath, 'and board target:', boardTarget)
    let result: MethodsResult = { success: false }
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
      result = { success: true, data: results }
    } catch (_error) {
      console.error('Error creating directories')
      result.data = _error
    }

    return result
  }

  async copyStaticFiles(compilationPath: string): Promise<MethodsResult> {
    console.log('Copying static build files...')
    let result: MethodsResult = { success: false }
    const staticArduinoFilesPath = join(this.sourceDirectoryPath, 'arduino')
    const staticBaremetalFilesPath = join(this.sourceDirectoryPath, 'baremetal')

    try {
      // Implement the logic to copy static build files.
      const results = await Promise.all([
        cp(staticArduinoFilesPath, join(compilationPath, 'arduino'), { recursive: true }),
        cp(staticBaremetalFilesPath, join(compilationPath, 'baremetal'), { recursive: true }),
      ])
      console.log('Static build files copied successfully:', results)
      result = { success: true, data: results }
    } catch (error) {
      console.error(`Error copying static build files: ${String(error)}`)
      result.data = error
    }

    return result
  }

  // +++++++++++++++++++++++++++ Compilation Methods +++++++++++++++++++++++++++++

  // ++ ========================= Compiler builder ============================ ++

  /**
   * This will be the main entry point for the compiler module.
   * It will handle all the compilation process, will orchestrate the various steps involved in compiling a program.
   */
  compileProgram() {
    // Placeholder for compile program logic
    console.log('Compiling program...')
  }
}
export { CompilerModule }
