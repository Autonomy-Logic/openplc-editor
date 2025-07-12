import { cp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

// import type { ArduinoCliConfig, BoardInfo, HalsFile } from './compiler-types'

interface BuildStepResult {
  success: boolean
  data?: unknown
}

class CompilerModule {
  binaryDirectoryPath: string
  sourceDirectoryPath: string

  constructor() {
    this.binaryDirectoryPath = this.#constructBinaryDirectoryPath()
    this.sourceDirectoryPath = this.#constructSourceDirectoryPath()
  }

  // ############################################################################
  // =========================== Static methods ================================
  // ############################################################################

  // ############################################################################
  // =========================== Private methods ================================
  // ############################################################################

  // Initialize paths based on the environment
  #constructBinaryDirectoryPath(): string {
    const isDevelopment = process.env.NODE_ENV === 'development'
    return join(isDevelopment ? process.cwd() : process.resourcesPath, isDevelopment ? 'resources' : '', 'bin')
  }

  #constructSourceDirectoryPath(): string {
    const isDevelopment = process.env.NODE_ENV === 'development'
    return join(isDevelopment ? process.cwd() : process.resourcesPath, isDevelopment ? 'resources' : '', 'sources')
  }

  //   async #initializeBuildEnvironment(): Promise<void> {}

  // ############################################################################
  // =========================== Public methods =================================
  // ############################################################################

  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // ++ ========================= Build Steps ================================= ++
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

  // ========================= Initialization Methods =========================
  async createDirectories(projectFolderPath: string, boardTarget: string): Promise<BuildStepResult> {
    console.log('Creating directories for project:', projectFolderPath, 'and board target:', boardTarget)
    let res: BuildStepResult = { success: false }
    const buildDirectory = join(projectFolderPath, 'build')
    const boardDirectory = join(buildDirectory, boardTarget)
    const sourceDirectory = join(boardDirectory, 'src')
    try {
      const results = await Promise.all([
        mkdir(boardDirectory, { recursive: true }),
        mkdir(sourceDirectory, { recursive: true }),
      ])
      res = { success: true, data: results }
    } catch (_error) {
      console.error('Error creating directories')
      res.data = _error
    }
    return res
  }

  async copyStaticBuildFiles(compilationPath: string): Promise<BuildStepResult> {
    console.log('Copying static build files...')
    let res: BuildStepResult = { success: false }
    const staticArduinoFilesPath = join(this.sourceDirectoryPath, 'arduino')
    const staticBaremetalFilesPath = join(this.sourceDirectoryPath, 'baremetal')
    try {
      // Implement the logic to copy static build files
      const results = await Promise.all([
        cp(staticArduinoFilesPath, join(compilationPath, 'arduino'), { recursive: true }),
        cp(staticBaremetalFilesPath, join(compilationPath, 'baremetal'), { recursive: true }),
      ])
      console.log('Static build files copied successfully:', results)
      res = { success: true, data: results }
    } catch (error) {
      console.error(`Error copying static build files: ${String(error)}`)
      res.data = error
    }
    return res
  }

  async createFiles(): Promise<void> {}

  // ========================= Compilation Methods ============================

  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  // ++ ========================= Compiler builder ============================ ++
  // +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
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
