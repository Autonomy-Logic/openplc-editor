import { app } from 'electron'
import { existsSync, mkdir, readFile } from 'fs'
import { join } from 'path'

import { CreateJSONFile } from '../project-service/utils/json-creator'

class UserService {
  private userDataPath!: string
  private createUserDataFolder() {
    const pathToUserData = join(app.getPath('userData'), 'user')
    const userDataPathExists = existsSync(pathToUserData)
    if (!userDataPathExists) {
      mkdir(pathToUserData, { recursive: true }, (err, path) => {
        if (!err && path) {
          this.userDataPath = path
        } else {
          throw err
        }
      })
    } else {
      this.userDataPath = pathToUserData
    }
  }
  constructor() {
    this.createUserDataFolder()
    this.createUserSettings()
    this.createUserHistory()
  }

  private createUserSettings() {
    const settingsFile = {
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

    CreateJSONFile({
      path: this.userDataPath,
      data: JSON.stringify(settingsFile, null, 2),
      fileName: 'settings',
    })
  }

  async getSetting(key: 'theme-preference' | 'window') {
    type IUserSettings = {
      'theme-preference': string
      window: {
        bounds: {
          width: number
          height: number
          x: number
          y: number
        }
      }
    }
    const setting = await new Promise<IUserSettings>((resolve, reject) => {
      let settingValue: IUserSettings // specify the type of baseLibrary
      const filePath = join(this.userDataPath, 'config.json')
      readFile(filePath, 'utf-8', (error, data) => {
        if (!error && data) {
          settingValue = JSON.parse(data) as IUserSettings
          resolve(settingValue) // resolve the promise with the parsed data
        } else {
          reject(error) // reject the promise if there's an error
        }
      })
    })

    return setting[key]
  }

  private createUserHistory() {
    CreateJSONFile({
      path: this.userDataPath,
      data: '[]',
      fileName: 'history',
    })
  }

  getUserHistory() {}
}

export { UserService }
