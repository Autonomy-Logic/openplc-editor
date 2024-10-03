import { app } from 'electron'
import { access, constants, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

const DEFAULT_SETTINGS = {
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

const DEFAULT_HISTORY = {
  projects: [],
  libraries: [],
}

const createDirectoryIfNotExists = async (path: string): Promise<void> => {
  try {
    await access(path, constants.F_OK)
    console.log(`Directory found at ${path}`)
  } catch {
    try {
      await mkdir(path, { recursive: true })
      console.log(`Directory created at ${path}`)
    } catch (err) {
      console.error(`Error creating directory at ${path}: ${err.message}`)
    }
  }
}

const createFileIfNotExists = async (filePath: string, data: object): Promise<void> => {
  try {
    await writeFile(filePath, JSON.stringify(data, null, 2), { flag: 'wx' })
    console.log(`File created at ${filePath}`)
  } catch (err) {
    console.error(`Error creating file at ${filePath}: ${err.message}`)
  }
}

const UserService = {
  /**
   * Checks if the user base settings folder exists and creates it if it doesn't.
   * Also creates a user settings file with default values if it doesn't exist.
   *
   * @returns {Promise<void>} Resolves when the user base settings folder and file are ready.
   */
  checkIfUserBaseSettingsExists: async function (): Promise<void> {
    const pathToUserDataFolder = join(app.getPath('userData'), 'User')
    const pathToUserDataFile = join(pathToUserDataFolder, 'settings.json')

    await createDirectoryIfNotExists(pathToUserDataFolder)
    await createFileIfNotExists(pathToUserDataFile, DEFAULT_SETTINGS)
  },

  /**
   * Checks if the user history folder exists and creates it if it doesn't.
   * Also creates a user history file with default values if it doesn't exist.
   *
   * @returns {Promise<void>} Resolves when the user history folder and file are ready.
   */
  checkIfUserHistoryFolderExists: async function (): Promise<void> {
    const pathToUserHistoryFolder = join(app.getPath('userData'), 'User', 'History')
    const pathToUserProjectInfoFile = join(pathToUserHistoryFolder, 'projects.json')
    const pathToUserLibraryInfoFile = join(pathToUserHistoryFolder, 'libraries.json')

    await createDirectoryIfNotExists(pathToUserHistoryFolder)
    await createFileIfNotExists(pathToUserProjectInfoFile, DEFAULT_HISTORY)
    await createFileIfNotExists(pathToUserLibraryInfoFile, DEFAULT_HISTORY)
  },
}

export { UserService }
