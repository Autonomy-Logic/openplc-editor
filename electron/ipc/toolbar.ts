import { ipcMain } from 'electron';

import { CONSTANTS } from '../../src/shared';
import { store } from '../store';

const { channels } = CONSTANTS;

export const ipcToolBar = () => {
  ipcMain.on(channels.GET_TOOLBAR_POSITION, (event) => {
    const position = store.get('toolbar.position');
    event.sender.send(channels.GET_TOOLBAR_POSITION, position);
  });

  ipcMain.on(channels.SET_TOOLBAR_POSITION, (_event, arg) => {
    store.set('toolbar.position', arg);
  });
};
