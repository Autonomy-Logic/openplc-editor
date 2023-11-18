/* eslint-disable no-console */
import { Event } from 'electron';
import { IpcMainEvent } from 'electron/main';
import * as validations from '../../../main/contracts/validations';
import * as MainProcessTypes from '../../contracts/types';
import * as MainProcessDtos from '../../contracts/dtos';

class MainProcessBridge extends MainProcessTypes.IpcMainModule {
  ipcMain;
  mainWindow;
  projectService;
  store;
  constructor({
    ipcMain,
    mainWindow,
    projectService,
    store,
  }: MainProcessTypes.IpcMainModuleConstructor) {
    super();
    this.ipcMain = ipcMain;
    this.mainWindow = mainWindow;
    this.projectService = projectService;
    this.store = store;
  }
  setupMainIpcListener() {
    this.ipcMain.handle(
      'app:store-get',
      this.mainIpcEventHandlers.getStoreValue,
    );
    this.ipcMain.on('app:store-set', this.mainIpcEventHandlers.setStoreValue);

    this.ipcMain.on(
      'project:save-response',
      async (_, data: MainProcessDtos.IProjectData) =>
        this.projectService.saveProject(data),
    );

    // Wip: From here
    this.ipcMain.handle('app:get-theme', this.mainIpcEventHandlers.getTheme);
    this.ipcMain.on('app:set-theme', this.mainIpcEventHandlers.setTheme);
  }

  mainIpcEventHandlers = {
    getStoreValue: async (_: Event, key: string): Promise<string> => {
      const response = this.store.get(key) as unknown as string;
      return response;
    },
    setStoreValue: (_: IpcMainEvent, key: string, val: string): void =>
      this.store.set(key, val),
    createPou: () =>
      this.mainWindow?.webContents.send('pou:createPou', { ok: true }),
    getTheme: () => {
      const theme = this.store.get('theme');
      return theme;
    },
    setTheme: (_: IpcMainEvent, arg: MainProcessTypes.IThemeProps) => {
      const theme = validations.ThemeSchema.parse(arg);
      this.store.set('theme', theme);
    },

    saveProject: async (
      _: IpcMainEvent,
      args: MainProcessDtos.IProjectData,
    ) => {
      const response = await this.projectService.saveProject(args);
      return response;
    },
    // Wip: From here

    // getProject: async (_: Event, filePath: string) => {
    //   const response = await this.projectService.getProject(filePath);
    //   return response;
    // },
    // sendProjectData: async (filePath: string) => {
    //   const response = await this.projectService.getProject(filePath);
    //   this.mainWindow?.webContents.send('Data/Get:project', {
    //     ...response,
    //     data: { ...response.data, filePath },
    //   });
    // },
    sendToast: (args: MainProcessTypes.IToastProps) => {
      const message = validations.ToastSchema.parse(args);
      this.mainWindow?.webContents.send('get-toast', message);
    },
  };
}

export default MainProcessBridge;
