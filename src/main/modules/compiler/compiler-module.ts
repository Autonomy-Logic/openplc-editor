import { cp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

// import type { ArduinoCliConfig, BoardInfo, HalsFile } from './compiler-types'

class CompilerModule {
  binaryDirectoryPath: string
  sourceDirectoryPath: string

  constructor() {
    this.binaryDirectoryPath = this.#constructBinaryDirectoryPath()
    this.sourceDirectoryPath = this.#constructSourceDirectoryPath()
  }

  // ############################################################################
  // =========================== Static methods =================================
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

  // ============================== Initialization Methods ==============================
  async createDirectories(
    projectFolderPath: string,
    boardTarget: string,
  ): Promise<{ success: boolean; data?: unknown }> {
    let res: { success: boolean; data?: unknown } = { success: false }
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

  async copyStaticBuildFiles(compilationPath: string): Promise<void> {
    const staticArduinoFilesPath = join(this.sourceDirectoryPath, 'arduino')
    const staticBaremetalFilesPath = join(this.sourceDirectoryPath, 'baremetal')
    // Placeholder for copying static build files logic
    console.log('Copying static build files...')
    try {
      // Implement the logic to copy static build files
      const results = await Promise.all([
        cp(staticArduinoFilesPath, join(compilationPath, 'arduino'), { recursive: true }),
        cp(staticBaremetalFilesPath, join(compilationPath, 'baremetal'), { recursive: true }),
      ])
      console.log('Static build files copied successfully:', results)
    } catch (error) {
      console.error(`Error copying static build files: ${String(error)}`)
    }
  }
  async createFiles(): Promise<void> {}
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
