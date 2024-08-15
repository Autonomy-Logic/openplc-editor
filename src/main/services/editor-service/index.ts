import { app } from 'electron'
import { mkdir, open } from 'fs'
import { join } from 'path'

import { CreateJSONFile } from '../project-service/utils/json-creator'
import { BaseTypes } from './data'

// import { CreateJSONFile } from '../project-service/utils/json-creator'

class EditorService {
  private editorDataPath!: string
  constructor() {
    this.createEditorFolder()
    this.setBaseData()
  }
  private createEditorFolder() {
    const editorFolderPath = join(app.getPath('userData'), 'editor')

    /**
     * Asynchronously check if editor folder exists, and create it if not.
     */

    open(editorFolderPath, 'r', (err, fd) => {
      // If the editor folder exists already terminate the process.
      if (err === null) {
        console.log('Editor folder already exist!', fd) // TODO: Remove log
        return
      }
      // If the editor folder does not exist, create it.
      mkdir(editorFolderPath, { recursive: true }, (err, createdPath) => {
        if (createdPath) {
          console.log('Created editor folder at', createdPath)
          this.editorDataPath = createdPath
        }
        if (err) {
          console.log('Error creating editor folder', err)
        }
      })
      if (err) console.log('Error', err)
    })
  }
  private setBaseData() {
    // TODO: Implement this method to create base types JSON file.
    open(this.editorDataPath, 'w+', (error, fd) => {
      if (error) console.log('Can not open the requested file', error)
      else {
        CreateJSONFile({
          path: this.editorDataPath,
          data: JSON.stringify(BaseTypes, null, 2),
          fileName: 'base-types',
        })
        console.log('Base types JSON file created successfully', fd)
      }
    })
  }
  // if (!editorFolderExists) {
  //   mkdir(join(app.getPath('userData'), 'editor'), { recursive: true }, (err, createdPath) => {
  //     if (!err && createdPath) {
  //       this.editorPath = createdPathÍ
  //     } else {
  //       throw err
  //     }
  //     const baseTypes = [
  //       'bool',
  //       'sint',
  //       'int',
  //       'dint',
  //       'lint',
  //       'usint',
  //       'uint',
  //       'udint',
  //       'ulint',
  //       'real',
  //       'lreal',
  //       'time',
  //       'date',
  //       'tod',
  //       'dt',
  //       'string',
  //       'byte',
  //       'word',
  //       'dword',
  //       'lword',
  //       'loglevel',
  //     ]
  //     CreateJSONFile({
  //       path: createdPath,
  //       data: JSON.stringify(baseTypes, null, 2),
  //       fileName: 'base-types',
  //     })

  //     const baseLibrary = new Map()

  //     baseLibrary.set('type1', 'valueWithType1')
  //     CreateJSONFile({
  //       path: createdPath,
  //       data: JSON.stringify(baseLibrary, null, 2),
  //       fileName: 'base-library',
  //     })
  //   })
  // } else {
  //   this.editorPath = join(app.getPath('userData'), 'editor')
  // }
}

// getBaseTypes(): Promise<string[]> {
//   // specify the return type
//   return new Promise((resolve, reject) => {
//     let baseTypes: string[] // specify the type of baseTypes
//     const filePath = join(this.editorPath, 'base-types.json')
//     readFile(filePath, 'utf-8', (error, data) => {
//       if (!error && data) {
//         baseTypes = JSON.parse(data) as string[]
//         resolve(baseTypes) // resolve the promise with the parsed data
//       } else {
//         reject(error) // reject the promise if there's an error
//       }
//     })
//   })
// }

// getBaseLibrary() {
//   /** This must be refactored to fit the library type */
//   return new Promise((resolve, reject) => {
//     let baseLibrary // specify the type of baseLibrary
//     const filePath = join(this.editorPath, 'base-library.json')
//     readFile(filePath, 'utf-8', (error, data) => {
//       if (!error && data) {
//         baseLibrary = JSON.parse(data) as string[]
//         resolve(baseLibrary) // resolve the promise with the parsed data
//       } else {
//         reject(error) // reject the promise if there's an error
//       }
//     })
//   })
// }

export { EditorService }
