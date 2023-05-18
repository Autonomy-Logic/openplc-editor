import { CONSTANTS } from '@shared/constants';
import { ipcMain } from 'electron';

import { store } from '../store';

const { channels } = CONSTANTS;

export const ipcTheme = () => {
  ipcMain.on(channels.GET_THEME, (event) => {
    const theme = store.get('theme');
    event.sender.send(channels.GET_THEME, theme);
  });

  ipcMain.on(channels.SET_THEME, (_event, arg) => {
    store.set('theme', arg);
  });
};
