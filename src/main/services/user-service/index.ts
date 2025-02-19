import { app } from 'electron'
import { access, constants, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

import { HALS_DATA } from './data/hals'

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

  static DEFAULT_SETTINGS = {
    'theme-preference': 'light',
    window: {
      bounds: {
        width: 1124,
        height: 628,
        x: 0,
        y: 0,
      },
    },
  }

  static DEFAULT_HISTORY = {
    projects: [],
    libraries: [],
  }

  static ARDUINO_FILE_CONTENT = `board_manager:
  additional_urls:
      - https://arduino.esp8266.com/stable/package_esp8266com_index.json
      - https://espressif.github.io/arduino-esp32/package_esp32_index.json
      - https://github.com/stm32duino/BoardManagerFiles/raw/main/package_stmicroelectronics_index.json
      - https://raw.githubusercontent.com/CONTROLLINO-PLC/CONTROLLINO_Library/master/Boards/package_ControllinoHardware_index.json
      - https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json
      - https://facts-engineering.gitlab.io/facts-open-source/p1am/beta_file_hosting/package_productivity-P1AM_200-boardmanagermodule_index.json
      - https://raw.githubusercontent.com/facts-engineering/facts-engineering.github.io/master/package_productivity-P1AM-boardmanagermodule_index.json
      - https://raw.githubusercontent.com/VEA-SRL/IRUINO_Library/main/package_vea_index.json
  output:
  no_color: true
  `

  static HALS_FILE_CONTENT = HALS_DATA

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
          console.warn(`Directory already exists at ${path}. Skipping creation.`)
        } else if (err instanceof Error) {
          console.error(`Error creating directory at ${path}: ${String(err)}`)
        } else {
          console.error(`Error creating directory at ${path}: ${String(err)}`)
        }
      }
    }
  }

  static async createFileIfNotExists(filePath: string, data: object): Promise<void> {
    try {
      await writeFile(filePath, JSON.stringify(data, null, 2), { flag: 'wx' })
    } catch (err) {
      // If the error is due to the file already existing, log a warning and continue.
      if (err instanceof Error && err.message.includes('EEXIST')) {
        console.warn(`File already exists at ${filePath}. Skipping creation.`)
      } else if (err instanceof Error) {
        console.error(`Error creating file at ${filePath}: ${String(err)}`)
      } else {
        console.error(`Error creating file at ${filePath}: ${String(err)}`)
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
    await UserService.createFileIfNotExists(pathToUserDataFile, UserService.DEFAULT_SETTINGS)
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
    await UserService.createFileIfNotExists(pathToUserProjectInfoFile, UserService.DEFAULT_HISTORY.projects)
    await UserService.createFileIfNotExists(pathToUserLibraryInfoFile, UserService.DEFAULT_HISTORY.libraries)
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
        console.warn(`File already exists at ${pathToArduinoCliConfig}. Skipping creation.`)
      } else if (err instanceof Error) {
        console.error(`Error creating Arduino CLI config at ${pathToArduinoCliConfig}: ${String(err)}`)
      } else {
        console.error(`Error creating Arduino CLI config at ${pathToArduinoCliConfig}: ${String(err)}`)
      }
    }
  }

  /**
   * Checks if the Hals file exists and creates it if it doesn't.
   * TODO: This function must be refactored.
   * - Should include a verification for the runtime folder.
   * - Must be validate if the json content is being written correctly.
   * - Must validate if this implementation for the hals.json file is correct.
   */

  async _checkIfHalsFileExists(): Promise<void> {
    const pathToHalsFile = join(app.getPath('userData'), 'User', 'runtime', 'hals.json')
    try {
      await writeFile(pathToHalsFile, UserService.HALS_FILE_CONTENT, { flag: 'wx' })
    } catch (err) {
      console.warn(err)
    }
  }
  /**
   * Initializes user settings and history by checking the relevant folders and files.
   * This method should be called during the application startup process.
   *
   * @returns {Promise<void>} Resolves when all setup checks are complete.
   */
  async #initializeUserSettingsAndHistory(): Promise<void> {
    await this.#checkIfUserBaseSettingsExists()
    await this.#checkIfUserHistoryFolderExists()
    await this.#checkIfArduinoCliConfigExists()
  }
}

export { UserService }
