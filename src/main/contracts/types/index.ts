import { BrowserWindow, IpcMain, IpcMainEvent } from 'electron/main';
import { IpcRenderer, IpcRendererEvent } from 'electron/renderer';
import { z } from 'zod';

import * as Dtos from '../dtos';
import * as validations from '../validations';
import { StoreType } from '../../lib/store';

/**
 * Basic structure to create a project
 * @readonly - Intern use only.
 */
type Service = {};

export interface IProjectService extends Service {
  createProject: () => Promise<Dtos.TProjectResponse>;
  openProject: () => Promise<Dtos.TProjectResponse>;
  saveProject: ({
    path,
    data,
  }: Dtos.IProjectData) => Promise<Dtos.IGenericResponse>;
}

/**
 * Base type for theme.
 * @readonly - Intern use only.
 */
type Theme = z.infer<typeof validations.ThemeSchema>;

export interface IThemeProps extends Record<string, unknown> {
  theme: Theme;
}

/**
 * Base type for toast.
 * @readonly - Intern use only.
 */
type Toast = z.infer<typeof validations.ToastSchema>;

export interface IToastProps extends Record<string, unknown> {
  toast: Toast;
}

/**
 * Base type for child window.
 * @readonly - Intern use only.
 */
type ChildWindow = z.infer<typeof validations.ChildWindowSchema>;

export interface IChildWindowProps extends Record<string, unknown> {
  childWindow: ChildWindow;
}

/**
 * Base type for ipc module.
 * @readonly - Intern use only.
 */
export type IpcModuleBase = {};

export type IpcMainModuleConstructor = {
  ipcMain: IpcMain;
  mainWindow: InstanceType<typeof BrowserWindow> | null;
  projectService: IProjectService;
  store: StoreType;
};

type IpcRendererBaseCallback = (_event: IpcRendererEvent, ...args: any) => void;

export type IpcRendererModule = IpcModuleBase & {
  createProject: (callback: IpcRendererBaseCallback) => IpcRenderer;
  openProject: (callback: IpcRendererBaseCallback) => IpcRenderer;
  saveProject: (callback: IpcRendererBaseCallback) => IpcRenderer;
  getStoreValue: (key: string) => Promise<string>;
  setStoreValue: (key: string, val: string) => void;
};

/**
 * Abstract class for ipc module.
 * @class OplcMainProcess.IpcMainModule
 */
export abstract class IpcMainModule implements IpcModuleBase {
  abstract ipcMain: IpcMain;
  abstract mainWindow: InstanceType<typeof BrowserWindow> | null;
  abstract projectService: IProjectService;
  abstract store: StoreType;
  abstract setupMainIpcListener(): void;
  abstract mainIpcEventHandlers: {
    createPou: () => void;
    getTheme: () => string;
    setTheme: (_event: IpcMainEvent, args: IThemeProps) => void;
    saveProject: (_event: IpcMainEvent, args: Dtos.IProjectData) => void;
    sendToast: (args: IToastProps) => void;
  };
}
