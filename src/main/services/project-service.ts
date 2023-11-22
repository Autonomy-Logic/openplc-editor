/* eslint-disable prettier/prettier */
/* eslint-disable class-methods-use-this */
import { BrowserWindow, dialog } from 'electron';
import { promises, readFile, writeFile } from 'fs';
import { join } from 'path';
import { convert, create } from 'xmlbuilder2';

import {
  ProjectDto,
  TProjectService,
} from '../../types/main/services/project.service';
import { ResponseService } from '../../types/main/services/response';
import formatDate from '../../utils/formatDate';
import { i18n } from '../../utils/i18n';

// Wip: Refactoring project services.
class ProjectService implements TProjectService {
  mainWindow: InstanceType<typeof BrowserWindow>;
  constructor(mainWindow: InstanceType<typeof BrowserWindow>) {
    this.mainWindow = mainWindow;
  }
  /**
   * @description Asynchronous function to create a PLC xml project based on selected directory.
   * @returns A `promise` of `ServiceResponse` type.
   */
  // eslint-disable-next-line class-methods-use-this
  async createProject(): Promise<ResponseService<ProjectDto>> {
    // Show a dialog to select the project directory.
    const response = await dialog.showOpenDialog(this.mainWindow, {
      title: i18n.t('createProject:dialog.title'),
      properties: ['openDirectory'],
    });
    // If the dialog is canceled, return an unsuccessful response
    // otherwise, create a constant containing the selected directory path as a string.
    if (response.canceled) return { ok: false };
    const [filePath] = response.filePaths;

    // Checks asynchronously if the selected directory is empty.
    const isEmptyDir = async () => {
      try {
        const directory = await promises.opendir(filePath);
        const entry = await directory.read();
        await directory.close();
        return entry === null;
      } catch (error) {
        return false;
      }
    };

    // Todo: Add the path to the store that will be used for the recent projects data.

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
      };
    }
    // Create a JS Object with the project base structure
    const projectAsObj = {
      project: {
        '@xmlns': 'http://www.plcopen.org/xml/tc6_0201',
        '@xmlns:ns1': 'http://www.plcopen.org/xml/tc6.xsd',
        '@xmlns:xhtml': 'http://www.w3.org/1999/xhtml',
        '@xmlns:xsd': 'http://www.w3.org/2001/XMLSchema-instance',
        '@xsi:schemaLocation':
          'http://www.plcopen.org/xml/tc6_0200 http://www.plcopen.org/xml/tc6_0200',
        fileHeader: {
          '@companyName': 'Unknown',
          '@creationDateTime': formatDate(new Date()),
          '@productName': 'Unnamed',
          '@productVersion': '1',
        },
        contentHeader: {
          '@name': 'Unnamed',
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
          pous: {
            pou: [],
          },
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
    };

    // Create the project XML structure using xmlbuilder2.
    const projectAsXml = create(
      { version: '1.0', encoding: 'utf-8' },
      projectAsObj,
    );

    const projectPath = join(filePath, 'plc.xml');

    // bridge.userConfigIpc.setWorkspaceInfos({ folder: filePath });
    /**
     * Serialize the XML structure and write it to a file.
     * If the file creation failed, return an error response,
     * otherwise return a successful response with the created file path.
     */

    writeFile(projectPath, projectAsXml.end({ prettyPrint: true }), (error) => {
      if (error) throw error;
      return {
        ok: false,
        reason: {
          title: i18n.t('createProject:errors.failedToCreateFile.title'),
          description: i18n.t(
            'createProject:errors.failedToCreateFile.description',
          ),
        },
      };
    });
    return {
      ok: true,
      data: { projectPath, projectAsObj },
    };
  }
  // eslint-disable-next-line consistent-return
  async openProject(): Promise<
    ResponseService<{
      projectPath: string;
      projectAsObj: object;
    }>
  > {
    const response = await dialog.showOpenDialog(this.mainWindow, {
      title: i18n.t('openProject:dialog.title'),
      properties: ['openFile'],
      filters: [{ name: 'XML', extensions: ['xml'] }],
    });
    // If the dialog is canceled, return an unsuccessful response
    // otherwise, create a constant containing the selected directory path as a string.
    if (response.canceled) return { ok: false };
    const [filePath] = response.filePaths;

    const file = await new Promise((resolve, reject) => {
      readFile(filePath, 'utf-8', (error, data) => {
        if (error) return reject(error);
        return resolve(data);
      });
    });

    // If the file content is empty or not available, return an error response.
    if (!file) {
      return {
        ok: false,
        reason: {
          title: i18n.t('openProject:errors.readFile.title'),
          description: i18n.t('openProject:errors.readFile.description', {
            filePath,
          }),
        },
      };
    }
    // Convert the XML file content into a serialized object.
    const projectAsObj = convert(file, {
      format: 'object',
    });

    /**
     * Return a successful response with the project data,
     * which is the path to the XML file and the content serialized as a JavaScript object.
     */
    return {
      ok: true,
      data: {
        projectPath: filePath,
        projectAsObj,
      },
    };
  }
  /**
   * @description   Executes the service to save a project as an XML file.
   * @param filePath - The path where the XML file should be saved.
   * @param xmlSerializedAsObject - The XML data to be serialized and saved.
   * @returns A `promise` of `ResponseService` type.
   */
  async saveProject(data: ProjectDto): Promise<any | void> {
    const { projectPath, projectAsObj } = data;
    // Check if required parameters are provided.
    if (!projectPath || !projectAsObj)
      return {
        ok: false,
        reason: {
          title: i18n.t('saveProject:errors.failedToSaveFile.title'),
          description: i18n.t(
            'saveProject:errors.failedToSaveFile.description',
          ),
        },
      };

    // Serialize the XML data using xmlbuilder2.
    const projectAsXml = create(
      // { parser: { cdata: (projectAsObj) => projectAsObj } },
      projectAsObj,
    );

    /**
     * Write the serialized xml to a file.
     * If the file saving failed, return an error response,
     * otherwise return a successful response.
     */
    writeFile(projectPath, projectAsXml.end({ prettyPrint: true }), (error) => {
      if (error) throw error;
      return {
        ok: false,
        reason: {
          title: i18n.t('saveProject:errors.failedToSaveFile.title'),
          description: i18n.t(
            'saveProject:errors.failedToSaveFile.description',
          ),
        },
      };
    });
    console.log('Works!');

    return {
      ok: true,
      reason: {
        title: i18n.t('saveProject:success.successToSaveFile.title'),
        description: i18n.t(
          'saveProject:success.successToSaveFile.description',
        ),
      },
    };
  }
}

export default ProjectService;
