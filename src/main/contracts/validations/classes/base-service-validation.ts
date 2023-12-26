import { BrowserWindow } from 'electron/main';

import {
  CreateProjectResponse,
  OpenProjectResponse,
  SaveProjectRequestData,
  SaveProjectResponse,
} from '../../dtos';

/* eslint-disable class-methods-use-this */
abstract class BaseProjectService {
  mainWindow: InstanceType<typeof BrowserWindow>;
  constructor(mainWindow: InstanceType<typeof BrowserWindow>) {
    this.mainWindow = mainWindow;
  }
  abstract createProject(): Promise<CreateProjectResponse>;
  abstract openProject(): Promise<OpenProjectResponse>;
  abstract saveProject(dataToSave: SaveProjectRequestData): Promise<SaveProjectResponse>;
}

export default BaseProjectService;
