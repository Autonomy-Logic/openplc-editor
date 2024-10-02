import { app } from 'electron'
import { access, constants, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

const UserService = {
  /**
   * Checks if the user base settings folder exists and creates it if it doesn't.
   * Also creates a user settings file with default values if it doesn't exist.
   *
   * @returns {Promise<void>} Resolves when the user base settings folder and file are ready.
   */
  checkIfUserBaseSettingsExists: async function (): Promise<void> {
    // Construct the user folder path.
    const pathToUserDataFolder = join(app.getPath('userData'), 'User')
    // Construct the user settings file path.
    const pathToUserDataFile = join(pathToUserDataFolder, 'settings.json')
    // Check if user folder exists. If not, create it.
    try {
      await access(pathToUserDataFolder, constants.F_OK)
      console.log(`User setting folder found at ${pathToUserDataFolder}`)
    } catch (_err) {
      try {
        const settingsFolder = await mkdir(pathToUserDataFolder, { recursive: true })
        console.log(`User setting folder created at ${settingsFolder}`)
        return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        console.error(`Error creating user setting folder: ${err.message}`)
        return
      }
    } finally {
      // Check if the user setting file exists. If not, create it.
      try {
        await writeFile(
          pathToUserDataFile,
          JSON.stringify(
            {
              'theme-preference': 'light',
              window: {
                bounds: {
                  width: 1124,
                  height: 628,
                  x: 0,
                  y: 0,
                },
              },
            },
            null,
            2,
          ),
          // This flag opens the file to writing and creates if it doesn't exist, and fails if it already exists.
          { flag: 'wx' },
        )
        console.log(`User setting file created at ${pathToUserDataFile}`)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        console.error(`Error creating user setting folder: ${err.message}`)
      }
    }
  },
  /**
   * Checks if the user history folder exists and creates it if it doesn't.
   * Also creates a user history file with default values if it doesn't exist.
   *
   * @returns {Promise<void>} Resolves when the user history folder and file are ready.
   */
  checkIfUserHistoryFolderExists: async function (): Promise<void> {
    // Construct the user folder path.
    const pathToUserFolder = join(app.getPath('userData'), 'User')
    // Construct the user history folder path.
    const pathToUserHistoryFolder = join(pathToUserFolder, 'History')
    // Construct the user project history file path.
    const pathToUserProjectInfoFile = join(pathToUserHistoryFolder, 'projects.json')
    // Construct the user library history file path.
    const pathToUserLibraryInfoFile = join(pathToUserHistoryFolder, 'libraries.json')

    // Check if the user project history file exists. If not, create it.
    try {
      await access(pathToUserProjectInfoFile, constants.F_OK)
      console.log(`User project history file found at ${pathToUserProjectInfoFile}`)
    } catch (_err) {
      // If the file doesn't exist, create it.
      try {
        await writeFile(
          pathToUserProjectInfoFile,
          JSON.stringify(
            {
              projects: [],
            },
            null,
            2,
          ),
          // This flag opens the file to writing and creates if it doesn't exist, and fails if it already exists.
          { flag: 'wx' },
        )
        console.log(`User project history file created at ${pathToUserProjectInfoFile}`)
      } catch (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        _err: any
      ) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        console.error(`Error creating user project history file: ${_err.message}`)
        return
      }
    }

    // Check if the user library history file exists. If not, create it.
    try {
      await access(pathToUserLibraryInfoFile, constants.F_OK)
      console.log(`User library history file found at ${pathToUserLibraryInfoFile}`)
    } catch (_err) {
      // If the file doesn't exist, create it.
      try {
        await writeFile(
          pathToUserLibraryInfoFile,
          JSON.stringify(
            {
              libraries: [],
            },
            null,
            2,
          ),
          // This flag opens the file to writing and creates if it doesn't exist, and fails if it already exists.
          { flag: 'wx' },
        )
        console.log(`User library history file created at ${pathToUserLibraryInfoFile}`)
      } catch (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        _err: any
      ) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        console.error(`Error creating user library history file: ${_err.message}`)
        return
      }
    }
  },
}

export { UserService }
