import { app } from 'electron/main'
import { close, open } from 'fs'
import { access, constants } from 'fs/promises'
import { join } from 'path'

import { CreateJSONFile } from './services/project-service/utils/json-creator'

const UserSettings = {
  userSettingsFolderPath: join(app.getPath('userData'), 'User'),
  checkIfUserFolderExists: async function () {
    const pathToUserData = this.userSettingsFolderPath
    try {
      await access(pathToUserData, constants.R_OK | constants.F_OK)
      console.log(`User folder exists at ${pathToUserData}`)
    } catch {
      console.error(`User folder does not exist at ${pathToUserData}`)
      return false
    }
  },
  createUserFolder: async function () {
    
  }
}

export { UserSettings }
