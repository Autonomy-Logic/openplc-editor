import { Event, ipcRenderer } from 'electron';
import { ProjectDto } from '../../../types/main/services/project.service';

type IpcRendererCallbacks = (_event: Event, ...args: any) => void;
// export type RendererBridgeIPCMethods = {
//   createProject: (callback: any) => void;
//   openProject: (callback: any) => void;
//   saveProject: (data: ProjectDto) => void;
//   getTheme: () => void;
//   setTheme: (themeData: any) => void;
//   createPou: (callback: any) => void;
// };
const rendererProcessBridge = {
  createProject: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('project:create', callback),
  openProject: (callback: IpcRendererCallbacks) =>
    ipcRenderer.on('project:open', callback),
  // WIP: Refactoring
  saveProject: (data: ProjectDto) => ipcRenderer.invoke('project:save', data),
  getTheme: () => ipcRenderer.invoke('app:get-theme'),
  setTheme: (themeData: any) => ipcRenderer.send('app:set-theme', themeData),
  createPou: (callback: any) => ipcRenderer.on('pou:create', callback),
};
export default rendererProcessBridge;
