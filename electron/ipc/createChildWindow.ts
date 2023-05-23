import { CONSTANTS } from '@shared/constants';
import { ChildWindowProps, childWindowSchema } from '@shared/types/childWindow';
import { BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';

import { mainWindow } from '../main';

const {
  channels: { set },
} = CONSTANTS;

export const createChildWindowIpc = () => {
  ipcMain.on(set.NEW_WINDOW, (_, arg: ChildWindowProps) => {
    const { path, hideMenuBar, ...newWindow } = childWindowSchema.parse(arg);
    const url = process.env.VITE_DEV_SERVER_URL;
    const indexHtml = join(process.env.DIST, 'index.html');
    const childWindow = new BrowserWindow({
      icon: join(process.env.PUBLIC, 'favicon.ico'),
      parent: mainWindow as BrowserWindow,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
      ...newWindow,
    });
    if (hideMenuBar) childWindow.setMenu(null);
    if (process.env.VITE_DEV_SERVER_URL) {
      childWindow.loadURL(`${url}${path}`);
    } else {
      childWindow.loadFile(indexHtml, { hash: path });
    }
  });
};
