import { BrowserWindow } from 'electron/main';

import { CreateProjectDTO, OpenProjectDTO, SaveProjectDTO } from '../../dtos';

/* eslint-disable class-methods-use-this */
abstract class BaseProjectService {
  mainWindowProp: InstanceType<typeof BrowserWindow>;
  constructor(mainWindow: InstanceType<typeof BrowserWindow>) {
    this.mainWindowProp = mainWindow;
  }
  abstract createProject(): Promise<CreateProjectDTO.response>;
  abstract openProject(): Promise<OpenProjectDTO.response>;
  abstract saveProject(dataToSave: SaveProjectDTO.request): Promise<SaveProjectDTO.response>;
}

export default BaseProjectService;
