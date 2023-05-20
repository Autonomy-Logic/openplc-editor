import { CONSTANTS } from '@shared/constants';
import { ToastMessageProps } from '@shared/types/message';

import { mainWindow } from '../main';

const { channels } = CONSTANTS;

export const toastIpc = {
  send: (message: ToastMessageProps) =>
    mainWindow?.webContents.send(channels.SET_TOAST, message),
};
