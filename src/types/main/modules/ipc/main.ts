import { BrowserWindow, IpcMain } from 'electron/main';
import { ProjectService } from '../../../../main/services';
import { ThemeProps } from '../../../theme';
import { ToastProps } from './toast';
import { StoreType } from '../../../../main/store';
import { ProjectDto } from '../../services/project.service';

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
