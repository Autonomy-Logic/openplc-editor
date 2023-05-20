import { CONSTANTS } from '@shared/constants';
import { ipcMain } from 'electron';

import { store } from '../store';

const { channels } = CONSTANTS;

export const toolbarIpc = () => {
  ipcMain.on(channels.GET_TOOLBAR_POSITION, (event) => {
    const position = store.get('toolbar.position');
    event.sender.send(channels.GET_TOOLBAR_POSITION, position);
  });

  ipcMain.on(channels.SET_TOOLBAR_POSITION, (_event, arg) => {
    store.set('toolbar.position', arg);
  });
};
