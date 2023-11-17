import { OplcMainProcess } from '../../contracts/types';
import { ipcRenderer } from 'electron';

const rendererProcessBridge: OplcMainProcess.Types.IpcRendererModule = {
  createProject: (callback) => ipcRenderer.on('project:create', callback),
  openProject: (callback) => ipcRenderer.on('project:open', callback),
  saveProject: (callback) => ipcRenderer.on('project:save-request', callback),
  getStoreValue: (key) => ipcRenderer.invoke('app:store-get', key),
  setStoreValue: (key, val) => ipcRenderer.send('app:store-set', key, val),
  // WIP: Refactoring
  // getTheme: () => ipcRenderer.invoke('app:get-theme'),
  // setTheme: (themeData: any) => ipcRenderer.send('app:set-theme', themeData),
  // createPou: (callback: any) => ipcRenderer.on('pou:create', callback),
};
export default rendererProcessBridge;
