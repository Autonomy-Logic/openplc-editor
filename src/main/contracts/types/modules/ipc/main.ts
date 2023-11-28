/* eslint-disable @typescript-eslint/no-explicit-any */
import { BrowserWindow, IpcMain } from 'electron/main';

import { ThemeProps } from '../../../../../types/theme';
import { ProjectService } from '../../../../services';
import { StoreType } from '../../../../store';
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
