import { app } from 'electron'
import { mkdir, open } from 'fs'
import { join } from 'path'

import { CreateJSONFile } from '../project-service/utils/json-creator'

const UserService = {
  createUserDataFolder: () => {
    // Construct the user folder path
    const userFolderPath = join(app.getPath('userData'), 'user')
    // Asynchronously check if user folder exists, and create it if not.
    open(userFolderPath, 'r', (err, fd) => {
      // If the user folder exists already terminate the process.
      if (err === null) {
        console.log('User folder already exist!', fd) // TODO: Remove log
        return
      } else if (err.code === 'ENOENT') {
        // If the user folder does not exist, create it.
        mkdir(userFolderPath, { recursive: true }, (err, createdPath) => {
          if (createdPath) {
            console.log('Created user folder at', createdPath)
          }
          if (err) {
            console.log('Error creating user folder', err)
          }
          return
        })
      }
      // If an error occurred while creating the user folder print the error message.
      if (err) console.log('Something went wrong. Error:', err)
    })
  },
  setUserData: () => {
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
    // Construct the user folder path
    const userFolderPath = join(app.getPath('userData'), 'user')
    open(join(userFolderPath, 'settings.json'), 'w+', (error, _fd) => {
      if (error) console.log('Can not open the requested file', error)
      else {
        CreateJSONFile(userFolderPath, JSON.stringify(settingsFile, null, 2), 'settings')
        console.log('Created base-types.json')
      }
    })
  },
}

export { UserService }
