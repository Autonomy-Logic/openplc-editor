import { app } from 'electron/main'
import { access, constants, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

const UserSettings = {
  userSettingsFolderPath: join(app.getPath('userData'), 'User'),
  /**
   * Checks if the user base settings folder exists and creates it if it doesn't.
   * Also creates a user settings file with default values if it doesn't exist.
   *
   * @returns {Promise<void>} Resolves when the user base settings folder and file are ready.
   */
  checkIfUserBaseSettingsExists: async function (): Promise<void> {
    // Construct the user folder path.
    const pathToUserData = this.userSettingsFolderPath
    // Check if user folder exists. If not, create it.
    try {
      await access(pathToUserData, constants.F_OK)
      console.log(`User setting folder found at ${pathToUserData}`)
    } catch (_err) {
      try {
        const settingsFolder = await mkdir(pathToUserData, { recursive: true })
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
          join(pathToUserData, 'settings.json'),
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
        console.log(`User setting file created at ${join(pathToUserData, 'settings.json')}`)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        console.error(`Error creating user setting folder: ${err.message}`)
      }
    }
  },
}

export { UserSettings }
