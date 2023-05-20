import { CONSTANTS } from '@shared/constants';

import { mainWindow } from '../main';

const { channels } = CONSTANTS;

export const createNewPouWindowIpc = {
  send: (message: boolean) =>
    mainWindow?.webContents.send(channels.SET_CREATE_NEW_POU_WINDOW, message),
};
