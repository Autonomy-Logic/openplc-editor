import { z } from 'zod';
import * as validations from './validations';
import { BrowserWindow, IpcMainEvent, IpcMain } from 'electron/main';
import { IpcRendererEvent, IpcRenderer } from 'electron/renderer';
import { ProjectService } from '../services';
import { StoreType } from '../lib/store';

export namespace OplcMainProcess {
  /**
   * Namespace containing types declarations for main process.
   * @namespace OplcMainProcess.Types
   */
  export namespace Types {
    /**
     * Basic structure to create a project
     * @readonly - Intern use only.
     */
    type Service = {};

    export interface IProjectService extends Service {
      createProject: () => Promise<Dtos.TProject>;
      openProject: () => Promise<Dtos.Response>;
      saveProject: ({
        path,
        data,
      }: Dtos.IProjectData) => Promise<Dtos.Response>;
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
    type IpcModuleBase = {};

    export type IpcMainModuleConstructor = {
      ipcMain: IpcMain;
      mainWindow: InstanceType<typeof BrowserWindow> | null;
      projectService: InstanceType<typeof ProjectService>;
      store: StoreType;
    };

    type IpcRendererBaseCallback = (
      _event: IpcRendererEvent,
      ...args: any
    ) => void;

    export type IpcRendererModule = IpcModuleBase & {
      createProject: (callback: IpcRendererBaseCallback) => IpcRenderer;
      openProject: (callback: IpcRendererBaseCallback) => IpcRenderer;
      saveProject: (callback: IpcRendererBaseCallback) => IpcRenderer;
      getStoreValue: (key: string) => Promise<string>;
      setStoreValue: (key: string, val: string) => void;
    };
  }

  /**
   * Dtos - Data Transfer Objects.
   * Namespace for Dtos.
   * @namespace OplcMainProcess.Dtos
   */
  export namespace Dtos {
    /**
     * Represents the response format for service operations.
     * @template T - The type of data included in the response.
     */
    type Response<T = unknown> = {
      /**
       * Indicates the success status of the service operation.
       */
      ok: boolean;
      /**
       * Optional details about the failure reason, if applicable.
       */
      reason?: {
        /**
         * Title describing the reason for failure.
         */
        title: string;
        /**
         * Additional description providing context about the failure.
         */
        description?: string;
      };
      /**
       * Optional data returned from the service operation.
       */
      data?: T;
    };

    export type TProject = Response<{
      projectPath: string;
      projectAsObj: object;
    }>;

    export interface IProjectData {
      path: string;
      data: object;
    }
  }

  /**
   * Abstract class for ipc module.
   * @class OplcMainProcess.IpcMainModule
   */
  export abstract class IpcMainModule implements Types.IpcModuleBase {
    abstract ipcMain: IpcMain;
    abstract mainWindow: InstanceType<typeof BrowserWindow> | null;
    abstract projectService: InstanceType<typeof ProjectService>;
    abstract store: StoreType;
    abstract setupMainIpcListener(): void;
    abstract mainIpcEventHandlers: {
      createPou: () => void;
      getTheme: () => string;
      setTheme: (_event: IpcMainEvent, args: Types.IThemeProps) => void;
      saveProject: (_event: IpcMainEvent, args: Dtos.IProjectData) => void;
      sendToast: (args: Types.IToastProps) => void;
    };
  }
}
