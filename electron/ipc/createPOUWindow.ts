import { CONSTANTS } from '@shared/constants';

import { mainWindow } from '../main';

const {
  channels: { set },
} = CONSTANTS;

export const createPOUWindowIpc = {
  send: () => mainWindow?.webContents.send(set.CREATE_POU_WINDOW, true),
};
