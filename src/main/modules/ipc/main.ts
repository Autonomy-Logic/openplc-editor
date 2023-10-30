/* eslint-disable no-console */
import { Event } from 'electron';
import { ThemeProps, ThemeSchema } from '../../../types/theme';
import { ToastProps, ToastSchema } from '../../../types/main/modules/ipc/toast';
import {
  MainIpcModule,
  MainIpcModuleConstructor,
} from '../../../types/main/modules/ipc/main';
import { ProjectDto } from '../../../types/main/services/project.service';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type StoreResponse = {
  ok: boolean;
  message: string;
};

class MainProcessBridge implements MainIpcModule {
  ipcMain;
  mainWindow;
  projectService;
  store;
  constructor({
    ipcMain,
    mainWindow,
    projectService,
    store,
  }: MainIpcModuleConstructor) {
    this.ipcMain = ipcMain;
    this.mainWindow = mainWindow;
    this.projectService = projectService;
    this.store = store;
  }
  setupMainIpcListener() {
    this.ipcMain.handle(
      'project:save',
      async (_event: Event, data: ProjectDto) =>
        this.projectService.saveProject(data),
    );
    this.ipcMain.handle(
      'app:store-get',
      this.mainIpcEventHandlers.getStoreValue,
    );
    this.ipcMain.on('app:store-set', this.mainIpcEventHandlers.setStoreValue);

    // Wip: From here

    this.ipcMain.handle('app:get-theme', this.mainIpcEventHandlers.getTheme);
    this.ipcMain.on('app:set-theme', this.mainIpcEventHandlers.setTheme);
  }

  mainIpcEventHandlers = {
    getStoreValue: async (_: Event, key: string): Promise<string> => {
      const response = this.store.get(key) as unknown as string;
      return response;
    },
    setStoreValue: (_: Event, key: string, val: string): void =>
      this.store.set(key, val),
    createPou: () =>
      this.mainWindow?.webContents.send('pou:createPou', { ok: true }),
    getTheme: () => {
      const theme = this.store.get('theme') as ThemeProps;
      return theme;
    },
    setTheme: (_: Event, arg: ThemeProps) => {
      const theme = ThemeSchema.parse(arg);
      this.store.set('theme', theme);
    },

    // Wip: From here

    getProject: async (_: Event, filePath: string) => {
      const response = await this.projectService.getProject(filePath);
      return response;
    },
    sendProjectData: async (filePath: string) => {
      const response = await this.projectService.getProject(filePath);
      this.mainWindow?.webContents.send('Data/Get:project', {
        ...response,
        data: { ...response.data, filePath },
      });
    },
    sendToast: (arg: ToastProps) => {
      const message = ToastSchema.parse(arg);
      this.mainWindow?.webContents.send('get-toast', message);
    },
  };
}

export default MainProcessBridge;
