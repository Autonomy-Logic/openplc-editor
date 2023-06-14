import { CONSTANTS } from '@shared/constants';

import { mainWindow } from '../main';

const {
  channels: { get },
} = CONSTANTS;

export const pou = {
  createWindow: () => mainWindow?.webContents.send(get.CREATE_POU_WINDOW, true),
};
