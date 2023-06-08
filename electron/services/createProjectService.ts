import { promises, writeFile } from 'node:fs';
import { join } from 'node:path';

import { i18n } from '@shared/i18n';
import { BrowserWindow, dialog } from 'electron';
import { create } from 'xmlbuilder2';

import { mainWindow } from '../main';
import { ServiceResponse } from './types/response';

const createProjectService = {
  async execute(): Promise<ServiceResponse<string>> {
    const response = await dialog.showOpenDialog(mainWindow as BrowserWindow, {
      title: i18n.t('createProject:dialog.title'),
      properties: ['openDirectory'],
    });

    if (response.canceled) return { ok: false };

    const [filePath] = response.filePaths;

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

    if (!(await isEmptyDir())) {
      return {
        ok: false,
        reason: {
          title: i18n.t('createProject:errors.directoryNotEmpty.title'),
          description: i18n.t('createProject:errors.directoryNotEmpty.description'),
        },
      };
    }

    const padTo2Digits = (num: number) => num.toString().padStart(2, '0');

    const formatDate = (date: Date) =>
      [
        date.getFullYear(),
        padTo2Digits(date.getMonth() + 1),
        padTo2Digits(date.getDate()),
      ].join('-') +
      'T' +
      [
        padTo2Digits(date.getHours()),
        padTo2Digits(date.getMinutes()),
        padTo2Digits(date.getSeconds()),
      ].join(':');

    const date = formatDate(new Date());

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
    );

    const plc = project.end({ prettyPrint: true });

    let failedToCreateFile = false;

    writeFile(join(filePath, 'plc.xml'), plc, (error) => {
      if (error) failedToCreateFile = false;
    });

    if (failedToCreateFile)
      return {
        ok: false,
        reason: {
          title: i18n.t('createProject:errors.failedToCreateFile.title'),
          description: i18n.t('createProject:errors.failedToCreateFile.description'),
        },
      };

    return { ok: true, data: filePath };
  },
};

export default createProjectService;
