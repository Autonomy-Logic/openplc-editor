/* eslint-disable no-console */
import { ThemeProps, ThemeSchema } from '../../../types/theme';
import { ToastProps, ToastSchema } from '../../../types/main/modules/ipc/toast';
import {
  MainIpcModule,
  MainIpcModuleConstructor,
} from '../../../types/main/modules/ipc/main';
import { ProjectDto } from '../../../types/main/services/project.service';

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
    this.ipcMain.handle('project:create', this.projectService.createProject);

    this.ipcMain.handle('project:open', this.projectService.openProject);

    this.ipcMain.handle('project:save', (_event, data: ProjectDto) =>
      this.projectService.saveProject(data),
    );

    this.ipcMain.handle('app:get-theme', this.mainIpcEventHandlers.getTheme);

    this.ipcMain.on('app:set-theme', this.mainIpcEventHandlers.setTheme);
  }

  mainIpcEventHandlers = {
    createPou: () =>
      this.mainWindow?.webContents.send('pou:createPou', { ok: true }),

    getTheme: () => {
      const theme = this.store.get('theme') as ThemeProps;
      return theme;
    },

    setTheme: (_event: any, arg: ThemeProps) => {
      const theme = ThemeSchema.parse(arg);
      this.store.set('theme', theme);
    },

    // Wip: From here
    getProject: async (_event: any, filePath: string) => {
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
