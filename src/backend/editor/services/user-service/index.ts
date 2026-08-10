import { getErrorMessage } from '@root/frontend/utils/get-error-message'
import { exec } from 'child_process'
import { app } from 'electron'
import { access, constants, mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { promisify } from 'util'

import { ARDUINO_DATA, HISTORY_DATA, SETTINGS_DATA } from './data/types'
import type { ArduinoListOutput } from './types'

/**
 * UserService class responsible for user settings and history management.
 * This class is a singleton and should be instantiated only once during the application lifecycle.
 * For now it is used as a static class, although it isn't recommended to use static classes in TypeScript.
 * This approach is taken to avoid the need for a singleton instance and to leave room for future changes in the class structure.
 */
class UserService {
  constructor() {
    void this.#initializeUserSettingsAndHistory()
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
          console.error(`Error creating directory at ${path}: ${getErrorMessage(err)}`)
        } else {
          console.error(`Error creating directory at ${path}: ${getErrorMessage(err)}`)
        }
      }
    }
  }

  static async createJSONFileIfNotExists(filePath: string, data: object): Promise<void> {
    try {
      await writeFile(filePath, JSON.stringify(data, null, 2), { flag: 'wx' })
    } catch (err) {
      // If the error is due to the file already existing, log a warning and continue.
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'EEXIST') {
        console.warn(`File already exists at ${filePath}.\nSkipping creation.`)
        return
      } else if (err instanceof Error) {
        console.error(`Error creating file at ${filePath}: ${getErrorMessage(err)}`)
        throw new Error(`Failed to create file at ${filePath}: ${getErrorMessage(err)}`)
      } else {
        console.error(`Error creating file at ${filePath}: ${getErrorMessage(err)}`)
        throw new Error(`Failed to create file at ${filePath}: ${getErrorMessage(err)}`)
      }
    }
  }

  static async deleteFile(filePath: string): Promise<void> {
    try {
      await rm(filePath, { recursive: true, force: true })
    } catch (err) {
      console.error(`Error deleting file at ${filePath}: ${getErrorMessage(err)}`)
      throw new Error(`Failed to delete file at ${filePath}: ${getErrorMessage(err)}`)
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
    const newFileName = basename(newFilePath)
    try {
      await rename(oldFilePath, newFilePath)
      return { success: true, data: { filePath: newFilePath } }
    } catch (err) {
      console.error(`Error renaming file at ${oldFilePath} to ${newFileName}: ${getErrorMessage(err)}`)
      return {
        success: false,
        error: { title: 'File Rename Error', description: 'Failed to rename file', error: err as Error },
      }
    }
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
   * Ensure the Arduino CLI configuration file exists and carries every
   * board-manager URL the editor ships with.
   *
   * This used to write with `{ flag: 'wx' }` and swallow `EEXIST`, which
   * made the file effectively write-once: any URL added to `ARDUINO_DATA`
   * after a user's first launch never reached them, and the only fix was
   * deleting the file by hand.  Now missing URLs are merged into the
   * existing config on every start.
   *
   * Merge, never overwrite: users add their own indexes and change other
   * settings in this file, and clobbering it would silently discard them.
   * Anything already present is left untouched, including ordering.
   */
  async #checkIfArduinoCliConfigExists(): Promise<void> {
    const pathToArduinoCliConfig = join(app.getPath('userData'), 'User', 'arduino-cli.yaml')
    try {
      await writeFile(pathToArduinoCliConfig, UserService.ARDUINO_FILE_CONTENT, { flag: 'wx' })
      return
    } catch (err) {
      if (!(err instanceof Error && err.message.includes('EEXIST'))) {
        console.error(`Error creating Arduino CLI config at ${pathToArduinoCliConfig}: ${getErrorMessage(err)}`)
        return
      }
    }

    // File already exists — reconcile its `additional_urls` with ours.
    try {
      const existing = await readFile(pathToArduinoCliConfig, 'utf-8')
      const shipped = UserService.ARDUINO_FILE_CONTENT.match(/^\s*-\s*(https?:\/\/\S+)\s*$/gm) ?? []
      const missing = shipped.map((line) => line.trim().replace(/^-\s*/, '')).filter((url) => !existing.includes(url))

      if (missing.length === 0) return

      // Splice the missing entries in under the existing `additional_urls:`
      // key, matching its indentation so the YAML stays valid.
      const anchor = existing.match(/^(\s*)additional_urls:\s*$/m)
      if (!anchor) {
        console.warn(
          `Arduino CLI config at ${pathToArduinoCliConfig} has no 'additional_urls' key. ` +
            `Leaving it alone; missing board indexes: ${missing.join(', ')}`,
        )
        return
      }
      const firstEntry = existing.match(/^(\s*)-\s*https?:\/\//m)
      const indent = firstEntry ? firstEntry[1] : `${anchor[1]}    `
      const updated = existing.replace(anchor[0], `${anchor[0]}\n${missing.map((u) => `${indent}- ${u}`).join('\n')}`)

      await writeFile(pathToArduinoCliConfig, updated, 'utf-8')
      console.warn(`Added ${missing.length} missing board manager URL(s) to ${pathToArduinoCliConfig}.`)
    } catch (err) {
      console.error(`Error updating Arduino CLI config at ${pathToArduinoCliConfig}: ${getErrorMessage(err)}`)
    }
  }

  async #executeArduinoCliCommand(command: string): Promise<{ stderr: string; stdout: string }> {
    const developmentMode = process.env.NODE_ENV === 'development'
    const executeCommand = promisify(exec)

    const platformSpecificBinaryPath = join(process.platform, process.arch)

    let binaryPath = join(
      developmentMode ? process.cwd() : process.resourcesPath,
      developmentMode ? 'resources' : '',
      'bin',
      developmentMode ? platformSpecificBinaryPath : '',
      'arduino-cli',
    )

    if (process.platform === 'win32') {
      binaryPath = `${binaryPath}.exe`
    }

    return executeCommand(`"${binaryPath}" ${command}`)
  }

  /**
   * Checks if the Core List file exists and creates it if it doesn't.
   * TODO: This function must be refactored.
   * - Must validate if this implementation for the core list file is correct.
   */

  async #checkIfArduinoCoreControlFileExists(): Promise<void> {
    const pathToRuntimeFolder = join(app.getPath('userData'), 'User', 'Runtime')
    const pathToArduinoCoreControlFile = join(pathToRuntimeFolder, 'arduino-core-control.json')

    const { stderr, stdout } = await this.#executeArduinoCliCommand('core list --json')
    if (stderr) {
      console.error(`Error listing cores: ${String(stderr)}`)
      return
    }

    const coreListOutput = JSON.parse(stdout) as ArduinoListOutput['core']

    const installedCoresFromListOutput = coreListOutput.platforms.map((core) => ({
      [core.id]: core.installed_version,
    }))

    await UserService.createDirectoryIfNotExists(pathToRuntimeFolder)
    await writeFile(pathToArduinoCoreControlFile, JSON.stringify(installedCoresFromListOutput, null, 2), { flag: 'w' })

    // This is a legacy file that is no longer used, should be removed in the next major release!!!
    const pathToLegacyHals = join(pathToRuntimeFolder, 'hals.json')
    await rm(pathToLegacyHals, { recursive: true, force: true })
  }

  async #checkIfArduinoLibraryControlFileExists() {
    const pathToRuntimeFolder = join(app.getPath('userData'), 'User', 'Runtime')
    const pathToArduinoLibraryControlFile = join(pathToRuntimeFolder, 'arduino-library-control.json')

    const { stderr, stdout } = await this.#executeArduinoCliCommand('lib list --json')
    if (stderr) {
      console.error(`Error listing libraries: ${String(stderr)}`)
      return
    }

    const libraryListOutput = JSON.parse(stdout) as ArduinoListOutput['library']

    const installedLibrariesFromListOutput = libraryListOutput.installed_libraries.map(({ library }) => ({
      [library.name]: library.version,
    }))

    await UserService.createDirectoryIfNotExists(pathToRuntimeFolder)
    await writeFile(pathToArduinoLibraryControlFile, JSON.stringify(installedLibrariesFromListOutput, null, 2), {
      flag: 'w',
    })
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
    await this.#checkIfArduinoCoreControlFileExists()
    await this.#checkIfArduinoLibraryControlFileExists()
  }
}

export { UserService }
