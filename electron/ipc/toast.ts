import { CONSTANTS } from '@shared/constants';
import { ToastProps, toastSchema } from '@shared/types/toast';

import { mainWindow } from '../main';

const {
  channels: { set },
} = CONSTANTS;

export const toastIpc = {
  send: (arg: ToastProps) => {
    const message = toastSchema.parse(arg);
    mainWindow?.webContents.send(set.TOAST, message);
  },
};
