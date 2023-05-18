import { BrowserWindow } from 'electron';

import { store } from '../store';

export const setupWindowListeners = (window: BrowserWindow) => {
  // Test actively push message to the Electron-Renderer
  window.webContents.on('did-finish-load', () => {
    window?.webContents.send('main-process-message', new Date().toLocaleString());
  });

  window.on('resize', () => {
    store.set('window.bounds', window?.getBounds());
  });

  window.on('close', () => {
    store.set('window.bounds', window?.getBounds());
  });

  window.on('move', () => {
    store.set('window.bounds', window?.getBounds());
  });
};
