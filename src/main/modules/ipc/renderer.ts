import { ipcRenderer,IpcRendererEvent } from 'electron';

type IpcRendererCallbacks = (_event: IpcRendererEvent, ...args: any) => void;

const rendererProcessBridge = {
  createProject: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('project:create', callback),
  openProject: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('project:open', callback),
  saveProject: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('project:save-request', callback),
  getStoreValue: (key: string) => ipcRenderer.invoke('app:store-get', key),
  setStoreValue: (key: string, val: string) =>
    ipcRenderer.send('app:store-set', key, val),
  // WIP: Refactoring
  getTheme: () => ipcRenderer.invoke('app:get-theme'),
  setTheme: (themeData: any) => ipcRenderer.send('app:set-theme', themeData),
  createPou: (callback: any) => ipcRenderer.on('pou:create', callback),
};
export default rendererProcessBridge;
