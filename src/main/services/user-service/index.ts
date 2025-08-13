import { exec } from 'child_process'
import { app } from 'electron'
import { access, constants, mkdir, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { promisify } from 'util'

import { ARDUINO_DATA } from './data/arduino'
import { HISTORY_DATA } from './data/history'
import { SETTINGS_DATA } from './data/settings'

/**
 * UserService class responsible for user settings and history management.
 * This class is a singleton and should be instantiated only once during the application lifecycle.
 * For now it is used as a static class, although it isn't recommended to use static classes in TypeScript.
 * This approach is taken to avoid the need for a singleton instance and to leave room for future changes in the class structure.
 */
class UserService {
  compilerDirectory: string
  constructor() {
    void this.#initializeUserSettingsAndHistory()
    this.compilerDirectory = this.#constructCompilerDirectoryPath()
  }

  /**
   * Static methods and properties.
   */

  static DEFAULT_SETTINGS = SETTINGS_DATA

  static DEFAULT_HISTORY = HISTORY_DATA

  static ARDUINO_FILE_CONTENT = ARDUINO_DATA

  static async createDirectoryIfNotExists(path: string): Promise<void> {
    /**
     * The access() method checks the existence of the file or directory at the specified path.
     * If the file or directory exists, the method resolves successfully.
     */
    try {
      await access(path, constants.F_OK)
    } catch {
      try {
        await mkdir(path, { recursive: true })
      } catch (err) {
        // If the error is due to the directory already existing, log a warning and continue.
        if (err instanceof Error && err.message.includes('EEXIST')) {
          console.warn(`Directory already exists at ${path}.\nSkipping creation.`)
        } else if (err instanceof Error) {
          console.error(`Error creating directory at ${path}: ${String(err)}`)
        } else {
          console.error(`Error creating directory at ${path}: ${String(err)}`)
        }
      }
    }
  }

  static async createJSONFileIfNotExists(filePath: string, data: object): Promise<void> {
    try {
      await writeFile(filePath, JSON.stringify(data, null, 2), { flag: 'wx' })
    } catch (err) {
      // If the error is due to the file already existing, log a warning and continue.
      if (err instanceof Error && err.message.includes('EEXIST')) {
        console.warn(`File already exists at ${filePath}.\nSkipping creation.`)
      } else if (err instanceof Error) {
        console.error(`Error creating file at ${filePath}: ${String(err)}`)
      } else {
        console.error(`Error creating file at ${filePath}: ${String(err)}`)
      }
    }
  }

  static async deleteFile(filePath: string): Promise<void> {
    try {
      await rm(filePath, { recursive: true, force: true })
    } catch (err) {
      console.error(`Error deleting file at ${filePath}: ${String(err)}`)
    }
  }

  static async renameFile(
    oldFilePath: string,
    newFilePath: string,
  ): Promise<{
    success: boolean
    error?: {
      title: string
      description: string
      error: Error
    }
    data?: { filePath: string }
  }> {
    const newFileName = newFilePath.split('/').pop() || ''
    try {
      await rename(oldFilePath, newFilePath)
      return { success: true, data: { filePath: newFilePath } }
    } catch (err) {
      console.error(`Error renaming file at ${oldFilePath} to ${newFileName}: ${String(err)}`)
      return {
        success: false,
        error: { title: 'File Rename Error', description: 'Failed to rename file', error: err as Error },
      }
    }
  }

  #constructCompilerDirectoryPath() {
    const isDevelopment = process.env.NODE_ENV === 'development'
    return join(isDevelopment ? process.cwd() : process.resourcesPath, isDevelopment ? 'resources' : '', 'compilers')
  }

  /**
   * -----------------------------------------------------------------------
   */

  /**
   * Checks if the user base settings folder exists and creates it if it doesn't.
   * Also creates a user settings file with default values if it doesn't exist.
   *
   * @returns {Promise<void>} Resolves when the user base settings folder and file are ready.
   */
  async #checkIfUserBaseSettingsExists(): Promise<void> {
    const pathToUserDataFolder = join(app.getPath('userData'), 'User')
    const pathToUserDataFile = join(pathToUserDataFolder, 'settings.json')

    await UserService.createDirectoryIfNotExists(pathToUserDataFolder)
    await UserService.createJSONFileIfNotExists(pathToUserDataFile, UserService.DEFAULT_SETTINGS)
  }

  async #checkIfLogFolderExists(): Promise<void> {
    const pathToLogFolder = join(app.getPath('userData'), 'logs')
    await UserService.createDirectoryIfNotExists(pathToLogFolder)
  }

  /**
   * Checks if the user history folder exists and creates it if it doesn't.
   * Also creates a user history file with default values if it doesn't exist.
   *
   * @returns {Promise<void>} Resolves when the user history folder and file are ready.
   */
  async #checkIfUserHistoryFolderExists(): Promise<void> {
    const pathToUserHistoryFolder = join(app.getPath('userData'), 'User', 'History')
    const pathToUserProjectInfoFile = join(pathToUserHistoryFolder, 'projects.json')
    const pathToUserLibraryInfoFile = join(pathToUserHistoryFolder, 'libraries.json')

    await UserService.createDirectoryIfNotExists(pathToUserHistoryFolder)
    await UserService.createJSONFileIfNotExists(pathToUserProjectInfoFile, UserService.DEFAULT_HISTORY.projects)
    await UserService.createJSONFileIfNotExists(pathToUserLibraryInfoFile, UserService.DEFAULT_HISTORY.libraries)
  }

  /**
   * Checks if the Arduino CLI configuration file exists and creates it if it doesn't.
   */
  async #checkIfArduinoCliConfigExists(): Promise<void> {
    const pathToArduinoCliConfig = join(app.getPath('userData'), 'User', 'arduino-cli.yaml')
    try {
      await writeFile(pathToArduinoCliConfig, UserService.ARDUINO_FILE_CONTENT, { flag: 'wx' })
    } catch (err) {
      // If the error is due to the file already existing, log a warning and continue.
      if (err instanceof Error && err.message.includes('EEXIST')) {
        console.warn(`File already exists at ${pathToArduinoCliConfig}.\nSkipping creation.`)
      } else if (err instanceof Error) {
        console.error(`Error creating Arduino CLI config at ${pathToArduinoCliConfig}: ${String(err)}`)
      } else {
        console.error(`Error creating Arduino CLI config at ${pathToArduinoCliConfig}: ${String(err)}`)
      }
    }
  }

  /**
   * Checks if the Core List file exists and creates it if it doesn't.
   * TODO: This function must be refactored.
   * - Must be validate if the json content is being written correctly.
   * - Must validate if this implementation for the core list file is correct.
   */

  // eslint-disable-next-line no-unused-private-class-members
  async #checkIfArduinoCoreControlFileExists(): Promise<void> {
    const arduinoCli = promisify(exec)
    const pathToRuntimeFolder = join(app.getPath('userData'), 'User', 'Runtime')
    const pathToArduinoCoreControlFile = join(pathToRuntimeFolder, 'arduino-core-control.json')
    let pathToArduinoCliBinary = ''

    switch (process.platform) {
      case 'win32':
        pathToArduinoCliBinary = join(this.compilerDirectory, 'Windows', 'arduino-cli', 'bin', 'arduino-cli.exe')
        break
      case 'darwin':
        pathToArduinoCliBinary = join(this.compilerDirectory, 'MacOS', 'arduino-cli', 'bin', 'arduino-cli')
        break
      case 'linux':
        pathToArduinoCliBinary = join(
          this.compilerDirectory,
          'Linux',
          'arduino-cli',
          'bin',
          `${process.arch === 'arm64' || process.arch === 'arm' ? 'arduino-cli-arm' : 'arduino-cli'}`,
        )
        break
      default:
        throw new Error(`Unsupported platform: ${process.platform}`)
    }

    const { stderr, stdout } = await arduinoCli(`"${pathToArduinoCliBinary}" core list --json`)
    if (stderr) {
      console.error(`Error listing cores: ${String(stderr)}`)
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const cores = JSON.parse(stdout)

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const coreControl = cores.platforms.map((core: { id: string; installed_version: string }) => ({
      [core.id]: core.installed_version,
    }))

    await UserService.createDirectoryIfNotExists(pathToRuntimeFolder)
    await UserService.createJSONFileIfNotExists(pathToArduinoCoreControlFile, coreControl as object)

    // This is a legacy file that is no longer used, should be removed in the next major release!!!
    const removeLegacy = promisify(rm)
    const pathToLegacyHals = join(pathToRuntimeFolder, 'hals.json')
    await removeLegacy(pathToLegacyHals, { recursive: true, force: true })
  }
  /**
   * Initializes user settings and history by checking the relevant folders and files.
   * This method should be called during the application startup process.
   *
   * @returns {Promise<void>} Resolves when all setup checks are complete.
   */
  async #initializeUserSettingsAndHistory(): Promise<void> {
    await this.#checkIfUserBaseSettingsExists()
    await this.#checkIfLogFolderExists()
    await this.#checkIfUserHistoryFolderExists()
    await this.#checkIfArduinoCliConfigExists()
    // await this.#checkIfArduinoCoreControlFileExists()
  }
}

export { UserService }
