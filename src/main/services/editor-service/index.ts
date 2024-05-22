import { app } from 'electron'
import { existsSync, mkdir, readFile } from 'fs'
import { join } from 'path'

import { CreateJSONFile } from '../project-service/utils/json-creator'

class EditorService {
  private editorPath!: string
  constructor() {
    this.createEditorFolderAndFiles()
  }
  private createEditorFolderAndFiles() {
    const editorFolderExists = existsSync(join(app.getPath('userData'), 'editor'))

    if (!editorFolderExists) {
      mkdir(join(app.getPath('userData'), 'editor'), { recursive: true }, (err, createdPath) => {
        if (!err && createdPath) {
          this.editorPath = createdPath
        } else {
          throw err
        }
        const baseTypes = [
          'bool',
          'sint',
          'int',
          'dint',
          'lint',
          'usint',
          'uint',
          'udint',
          'ulint',
          'real',
          'lreal',
          'time',
          'date',
          'tod',
          'dt',
          'string',
          'byte',
          'word',
          'dword',
          'lword',
          'loglevel',
        ]
        CreateJSONFile({
          path: createdPath,
          data: JSON.stringify(baseTypes, null, 2),
          fileName: 'base-types',
        })

        const baseLibrary = new Map()

        baseLibrary.set('type1', 'valueWithType1')
        CreateJSONFile({
          path: createdPath,
          data: JSON.stringify(baseLibrary, null, 2),
          fileName: 'base-library',
        })
      })
    } else {
      this.editorPath = join(app.getPath('userData'), 'editor')
    }
  }

  getBaseTypes(): Promise<string[]> {
    // specify the return type
    return new Promise((resolve, reject) => {
      let baseTypes: string[] // specify the type of baseTypes
      const filePath = join(this.editorPath, 'base-types.json')
      readFile(filePath, 'utf-8', (error, data) => {
        if (!error && data) {
          baseTypes = JSON.parse(data) as string[]
          resolve(baseTypes) // resolve the promise with the parsed data
        } else {
          reject(error) // reject the promise if there's an error
        }
      })
    })
  }

  getBaseLibrary() {
    /** This must be refactored to fit the library type */
    return new Promise((resolve, reject) => {
      let baseLibrary // specify the type of baseLibrary
      const filePath = join(this.editorPath, 'base-library.json')
      readFile(filePath, 'utf-8', (error, data) => {
        if (!error && data) {
          baseLibrary = JSON.parse(data) as string[]
          resolve(baseLibrary) // resolve the promise with the parsed data
        } else {
          reject(error) // reject the promise if there's an error
        }
      })
    })
  }
}
export { EditorService }
