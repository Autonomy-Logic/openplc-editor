import { app } from 'electron'
import { mkdir, open } from 'fs'
import { join } from 'path'

import { CreateJSONFile } from '../project-service/utils/json-creator'
import { UserService } from '../user-service'
import { BaseTypes } from './data'

const EditorService = {
  /**
   * Function to create a folder in app directory containing config files.
   */
  createEditorFolder: () => {
    // Construct the editor folder path
    const editorFolderPath = join(app.getPath('userData'), 'editor')
    // Asynchronously check if editor folder exists, and create it if not.
    open(editorFolderPath, 'r', (err, fd) => {
      // If the editor folder exists already terminate the process.
      if (err === null) {
        console.log('Editor folder already exist!', fd) // TODO: Remove log
        return
      } else if (err.code === 'ENOENT') {
        // If the editor folder does not exist, create it.
        mkdir(editorFolderPath, { recursive: true }, (err, createdPath) => {
          if (createdPath) {
            console.log('Created editor folder at', createdPath)
          }
          if (err) {
            console.log('Error creating editor folder', err)
          }
          return
        })
      }
      // If an error occurred while creating the editor folder print the error message.
      if (err) console.log('Something went wrong. Error:', err)
    })
  },

  createHistoryFolder: () => {
    // Construct the editor folder path
    const pathToUserFolder = join(app.getPath('userData'), 'User')
    const pathToUserHistoryFolder = join(pathToUserFolder, 'History')

    // Asynchronously check if user history folder exists, and create it if not.
    open(pathToUserHistoryFolder, 'r', (err, fd) => {
      // If the user history folder exists already terminate the process.
      if (err === null) {
        console.log('User history folder already exist!', fd)
        void UserService.checkIfUserHistoryFolderExists()
        return
      } else if (err.code === 'ENOENT') {
        // If the user history folder does not exist, create it.
        mkdir(pathToUserHistoryFolder, { recursive: true }, (err, createdPath) => {
          if (createdPath) {
            console.log('Created user history folder at', createdPath)

            void UserService.checkIfUserHistoryFolderExists()
          }
          if (err) {
            console.log('Error creating user history folder', err)
          }
          return
        })
      }
      // If an error occurred while creating the user history folder print the error message.
      if (err) console.log('Something went wrong. Error:', err)
    })
  },

  /**
   * Function to create base data on different JSON files in editor folder.
   */
  setBaseData: () => {
    // Construct the editor folder path
    const editorFolderPath = join(app.getPath('userData'), 'editor')
    // Create base-types.json file in editor folder if it does not exist.
    open(join(editorFolderPath, 'base-types.json'), 'w+', (error, _fd) => {
      if (error) console.log('Can not open the requested file', error)
      else {
        CreateJSONFile(editorFolderPath, JSON.stringify(BaseTypes, null, 2), 'base-types')
        console.log('Created base-types.json')
      }
    })
  },
}

export { EditorService }
