import { promises, readFile, writeFile } from 'node:fs'
import { join } from 'node:path'

import { i18n } from '@shared/i18n'
import { formatDate } from '@shared/utils'
import { BrowserWindow, dialog } from 'electron'
import { convert, create } from 'xmlbuilder2'
import { XMLSerializedAsObject } from 'xmlbuilder2/lib/interfaces'

import { mainWindow } from '../main'
import { ServiceResponse } from './types/response'

// Wip: Implements dependencies.
interface ServiceDependencies {
  dialog: typeof dialog
  readFile: typeof readFile
  writeFile: typeof writeFile
  formatDate: (date: Date) => string
}

// Wip: Implements dependencies.
class ProjectDependencies implements ServiceDependencies {
  dialog = dialog
  readFile = readFile
  writeFile = writeFile
  formatDate = formatDate
}

// Wip: Refactoring project services.
export class ProjectService {
  constructor(private readonly dependencies: ProjectDependencies) {}

  /**
   * @description Asynchronous function to create a PLC xml project based on selected directory.
   * @returns A `promise` of `ServiceResponse` type.
   */
  async createProject(): Promise<ServiceResponse<string>> {
    // Show a dialog to select the project directory.
    const response = await dialog.showOpenDialog(mainWindow as BrowserWindow, {
      title: i18n.t('createProject:dialog.title'),
      properties: ['openDirectory'],
    })
    // If the dialog is canceled, return an unsuccessful response
    // otherwise, create a constant containing the selected directory path as a string.
    if (response.canceled) return { ok: false }
    const [filePath] = response.filePaths

    // Checks asynchronously if the selected directory is empty.
    const isEmptyDir = async () => {
      try {
        const directory = await promises.opendir(filePath)
        const entry = await directory.read()
        await directory.close()
        return entry === null
      } catch (error) {
        return false
      }
    }

    // If the selected directory is not empty, return an error response.
    if (!(await isEmptyDir())) {
      return {
        ok: false,
        reason: {
          title: i18n.t('createProject:errors.directoryNotEmpty.title'),
          description: i18n.t(
            'createProject:errors.directoryNotEmpty.description',
          ),
        },
      }
    }

    // ? Verify this: Utility function, maybe this can be done directly in the object body.
    // Create a const containing infos about the time when the project was created.
    const date = formatDate(new Date())

    // Todo: Must create a project.
    // Create the project XML structure using xmlbuilder2.
    const project = create()

    /**
     * Serialize the XML structure and write it to a file.
     * If the file creation failed, return an error response,
     * otherwise return a successful response with the created file path.
     */
    writeFile(
      join(filePath, 'plc.xml'),
      project.end({ prettyPrint: true }),
      (error) => {
        if (error) throw error
        return {
          ok: false,
          reason: {
            title: i18n.t('createProject:errors.failedToCreateFile.title'),
            description: i18n.t(
              'createProject:errors.failedToCreateFile.description',
            ),
          },
        }
      },
    )
    return {
      ok: true,
      data: filePath,
    }
  }

  /**
   * @description Executes the service to read and process the project XML file.
   * @param filePath - The path to the project XML file.
   * @returns A `promise` of `ServiceResponse` type.
   */
  async getProject(
    filePath: string,
  ): Promise<ServiceResponse<XMLSerializedAsObject>> {
    // Construct the full path to the 'plc.xml' file.
    filePath = join(filePath, 'plc.xml')
    // Read the XML file asynchronously.
    const file = await new Promise((resolve, reject) =>
      readFile(filePath, 'utf-8', (error, data) => {
        if (error) return reject(error)
        return resolve(data)
      }),
    )
    // If the file content is empty or not available, return an error response.
    if (!file) {
      return {
        ok: false,
        reason: {
          title: i18n.t('getProject:errors.readFile.title'),
          description: i18n.t('getProject:errors.readFile.description', {
            filePath,
          }),
        },
      }
    }
    // Convert the XML file content into a serialized object.
    return {
      ok: true,
      data: {
        xmlSerializedAsObject: convert(file, {
          format: 'object',
        }) as XMLSerializedAsObject,
      },
    }
  }

  /**
   * @description   Executes the service to save a project as an XML file.
   * @param filePath - The path where the XML file should be saved.
   * @param xmlSerializedAsObject - The XML data to be serialized and saved.
   * @returns A `promise` of `ServiceResponse` type.
   */
  async saveProject(
    filePath: string,
    xmlSerializedAsObject: XMLSerializedAsObject,
  ): Promise<ServiceResponse<string>> {
    // Check if required parameters are provided.
    if (!filePath || !xmlSerializedAsObject)
      return {
        ok: false,
        reason: {
          title: i18n.t('saveProject:errors.failedToSaveFile.title'),
          description: i18n.t(
            'saveProject:errors.failedToSaveFile.description',
          ),
        },
      }

    // Create the full path to the 'plc.xml' file.
    filePath = join(filePath, 'plc.xml')

    // Serialize the XML data using xmlbuilder2.
    const project = create(xmlSerializedAsObject)

    /**
     * Write the serialized xml to a file.
     * If the file saving failed, return an error response,
     * otherwise return a successful response.
     */
    writeFile(
      join(filePath, 'plc.xml'),
      project.end({ prettyPrint: true }),
      (error) => {
        if (error) throw error
        return {
          ok: false,
          reason: {
            title: i18n.t('saveProject:errors.failedToSaveFile.title'),
            description: i18n.t(
              'saveProject:errors.failedToSaveFile.description',
            ),
          },
        }
      },
    )
    return {
      ok: true,
      reason: {
        title: i18n.t('saveProject:success.successToSaveFile.title'),
        description: i18n.t(
          'saveProject:success.successToSaveFile.description',
        ),
      },
    }
  }
}

// Wip: Refactoring project services.
// const dependenciesProvider = new ProjectDependencies()
// export const projectService = new ProjectService(dependenciesProvider)
