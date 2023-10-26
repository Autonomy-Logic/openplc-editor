import { ipcRenderer } from 'electron';
import { ProjectDto } from '../../../types/main/services/project.service';

const rendererProcessBridge = {
  createProject: (callback: any) => ipcRenderer.on('project:create', callback),
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProject: (data: ProjectDto) => ipcRenderer.invoke('project:save', data),
  getTheme: () => ipcRenderer.invoke('app:get-theme'),
  setTheme: (themeData: any) => ipcRenderer.send('app:set-theme', themeData),
  createPou: (callback: any) => ipcRenderer.on('pou:create', callback),
};
export default rendererProcessBridge;
