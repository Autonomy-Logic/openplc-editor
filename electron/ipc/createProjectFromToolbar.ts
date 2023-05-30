import { CONSTANTS } from '@shared/constants';
import { ipcMain } from 'electron';

import { createProjectController } from '../controllers';

const {
  channels: { set },
} = CONSTANTS;

export const createProjectFromToolbarIpc = () => {
  ipcMain.on(set.CREATE_PROJECT_FROM_TOOLBAR, async (event) => {
    const response = await createProjectController.handle();
    event.sender.send(set.CREATE_PROJECT_FROM_TOOLBAR, response);
  });
};
