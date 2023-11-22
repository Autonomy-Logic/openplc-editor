import { BrowserWindow, IpcMain } from 'electron/main';

import { ProjectService } from '../../../../main/services';
import { StoreType } from '../../../../main/store';
import { ThemeProps } from '../../../theme';
import { ProjectDto } from '../../services/project.service';
import { ToastProps } from './toast';

export type MainIpcModule = {
  ipcMain: IpcMain;
  mainWindow: InstanceType<typeof BrowserWindow> | null;
  projectService: InstanceType<typeof ProjectService>;
  store: StoreType;
  setupMainIpcListener: () => void;
  mainIpcEventHandlers: {
    createPou: () => void;
    getTheme: () => ThemeProps;
    setTheme: (event: any, arg: ThemeProps) => void;
    saveProject: (_event: any, arg: ProjectDto) => void;
    sendToast: (arg: ToastProps) => void;
  };
};

export type MainIpcModuleConstructor = {
  ipcMain: IpcMain;
  mainWindow: InstanceType<typeof BrowserWindow> | null;
  projectService: InstanceType<typeof ProjectService>;
  store: StoreType;
};
