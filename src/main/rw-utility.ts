import { app } from 'electron'
import { access, constants, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

const UserSettings = {
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
}

const EditorSettings = {
  /**
   * Checks if the editor folder exists and creates it if it doesn't.
   * Also creates an editor file with default values if it doesn't exist.
   *
   * @returns {Promise<void>} Resolves when the editor folder are ready.
   */
  checkIfEditorFolderExists: async function (): Promise<void> {
    // Construct the editor folder path.
    const pathToEditorFolder = join(app.getPath('userData'), 'Editor')
    // Check if editor folder exists. If not, create it.
    try {
      await access(pathToEditorFolder, constants.F_OK)
      console.log(`Editor folder found at ${pathToEditorFolder}`)
    } catch (_err) {
      try {
        const editorFolder = await mkdir(pathToEditorFolder, { recursive: true })
        console.log(`Editor folder created at ${editorFolder}`)
        return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (_err: any) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        console.error(`Error creating editor folder: ${_err.message}`)
        return
      }
    }
  },
}

export { EditorSettings, UserSettings }
