import { promises, writeFile } from 'node:fs'
import { join } from 'node:path'

import { i18n } from '@shared/i18n'
import { formatDate } from '@shared/utils'
import { BrowserWindow, dialog } from 'electron'
import { create } from 'xmlbuilder2'

import { mainWindow } from '../main'
import { ServiceResponse } from './types/response'
/**
 * Service responsible for creating and initializing a new project XML file.
 */
const createProjectService = {
  /**
   * Executes the service to create a new project XML file.
   * @returns A promise containing the service response.
   */
  async execute(): Promise<ServiceResponse<string>> {
    // Show a dialog to select the project directory.
    const response = await dialog.showOpenDialog(mainWindow as BrowserWindow, {
      title: i18n.t('createProject:dialog.title'),
      properties: ['openDirectory'],
    })
    // If the dialog is canceled, return an unsuccessful response.
    if (response.canceled) return { ok: false }

    const [filePath] = response.filePaths
    // Checks if the selected directory is empty.
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

    const date = formatDate(new Date())
    // Create the project XML structure using xmlbuilder2.
    const project = create(
      { version: '1.0', encoding: 'utf-8' },
      {
        project: {
          '@xmlns:ns1': 'http://www.plcopen.org/xml/tc6.xsd',
          '@xmlns:xhtml': 'http://www.w3.org/1999/xhtml',
          '@xmlns:xsd': 'http://www.w3.org/2001/XMLSchema',
          '@xmlns': 'http://www.plcopen.org/xml/tc6_0201',
          fileHeader: {
            '@companyName': 'Unknown',
            '@productName': 'Unnamed',
            '@productVersion': '1',
            '@creationDateTime': date,
          },
          contentHeader: {
            '@name': 'Unnamed',
            '@modificationDateTime': date,
            coordinateInfo: {
              fbd: {
                scaling: {
                  '@x': '10',
                  '@y': '10',
                },
              },
              ld: {
                scaling: {
                  '@x': '10',
                  '@y': '10',
                },
              },
              sfc: {
                scaling: {
                  '@x': '10',
                  '@y': '10',
                },
              },
            },
          },
          types: {
            dataTypes: {},
            pous: {},
          },
          instances: {
            configurations: {
              configuration: {
                '@name': 'Config0',
                resource: {
                  '@name': 'Res0',
                },
              },
            },
          },
        },
      },
    )
    // Serialize the XML structure and write it to a file.
    const plc = project.end({ prettyPrint: true })

    let failedToCreateFile = false

    writeFile(join(filePath, 'plc.xml'), plc, (error) => {
      if (error) failedToCreateFile = true
    })
    // If the file creation failed, return an error response.
    if (failedToCreateFile)
      return {
        ok: false,
        reason: {
          title: i18n.t('createProject:errors.failedToCreateFile.title'),
          description: i18n.t(
            'createProject:errors.failedToCreateFile.description',
          ),
        },
      }
    // Return a successful response with the created file path.
    return { ok: true, data: filePath }
  },
}

export default createProjectService
