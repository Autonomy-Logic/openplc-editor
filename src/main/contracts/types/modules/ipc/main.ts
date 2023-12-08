/* eslint-disable @typescript-eslint/no-explicit-any */
import { BrowserWindow, IpcMain } from 'electron/main';

import { ProjectService } from '../../../../services';
import { TStoreType } from '../store';
import { ProjectDto } from '../../services/project.service';
import { ToastProps } from './toast';
import { ThemeDto } from '../../../../contracts/dtos/theme.dto';

export type MainIpcModule = {
  ipcMain: IpcMain;
  mainWindow: InstanceType<typeof BrowserWindow> | null;
  projectService: InstanceType<typeof ProjectService>;
  store: TStoreType;
  setupMainIpcListener: () => void;
  mainIpcEventHandlers: {
    createPou: () => void;
    getTheme: () => ThemeDto;
    setTheme: (event: any, arg: ThemeDto) => void;
    saveProject: (_event: any, arg: ProjectDto) => void;
    sendToast: (arg: ToastProps) => void;
  };
};

export type MainIpcModuleConstructor = {
  ipcMain: IpcMain;
  mainWindow: InstanceType<typeof BrowserWindow> | null;
  projectService: InstanceType<typeof ProjectService>;
  store: TStoreType;
};
