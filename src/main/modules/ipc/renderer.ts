import { ipcRenderer, IpcRendererEvent } from 'electron';

import {
  CreateProjectResponse,
  OpenProjectResponse,
  SaveProjectRequestData,
} from '../../contracts/dtos/index';

type IpcRendererCallbacks<T> = (_event: IpcRendererEvent, value: T) => void;

const rendererProcessBridge = {
  createProject: (callback: IpcRendererCallbacks<CreateProjectResponse>) =>
    ipcRenderer.on('project:create', callback),
  openProject: (callback: IpcRendererCallbacks<OpenProjectResponse>) =>
    ipcRenderer.on('project:open', callback),
  saveProject: (callback: IpcRendererCallbacks<SaveProjectRequestData>) =>
    ipcRenderer.on('project:save-request', callback),
  getStoreValue: (key: string) => ipcRenderer.invoke('app:store-get', key),
  setStoreValue: (key: string, val: string) => ipcRenderer.send('app:store-set', key, val),
  // WIP: Refactoring
  getTheme: () => ipcRenderer.invoke('app:get-theme'),
  // setTheme: (themeData: any) => ipcRenderer.send('app:set-theme', themeData),
  // createPou: (callback: any) => ipcRenderer.on('pou:create', callback),
};
export default rendererProcessBridge;
