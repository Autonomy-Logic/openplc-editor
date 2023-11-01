/* eslint-disable promise/always-return */
/* eslint-disable no-console */
import { Menu, BrowserWindow, MenuItemConstructorOptions } from 'electron';
import { i18n } from '../utils/i18n';
import { ProjectService } from './services';

/**
 * Todo: Can be used to construct a different menu for mac machines.
 */
// interface DarwinMenuItemConstructorOptions extends MenuItemConstructorOptions {
//   selector?: string;
//   submenu?: DarwinMenuItemConstructorOptions[] | Menu;
// }

/**
 * Class to manage the creation of menu.
 * @class MenuBuilder
 */
export default class MenuBuilder {
  mainWindow: BrowserWindow;

  projectService: InstanceType<typeof ProjectService>;

  developOptions: MenuItemConstructorOptions[] = [
    { type: 'separator' },
    { role: 'reload' },
    { role: 'forceReload' },
    { role: 'toggleDevTools' },
  ];

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
    this.projectService = new ProjectService(mainWindow);
  }

  buildMenu(): Menu {
    if (
      process.env.NODE_ENV === 'development' ||
      process.env.DEBUG_PROD === 'true'
    ) {
      this.setupDevelopmentEnvironment();
    }

    // Todo: Can be used to construct a different menu for mac machines.
    const template =
      // process.platform === 'darwin'
      //   ? this.buildDarwinTemplate() :
      this.buildDefaultTemplate();

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);

    return menu;
  }

  handleProject(channel: string): void {
    if (channel === 'project:create') {
      this.projectService
        .createProject()
        .then(({ ok, data }) => {
          if (ok && data) {
            this.mainWindow.webContents.send(channel, data);
            console.log(data);
          } else if (!ok) {
            console.warn('error in creating project');
          }
        })
        .catch((err) => {
          console.warn(err);
        });
    } else if (channel === 'project:open') {
      this.projectService
        .openProject()
        .then(({ ok, data, reason }) => {
          if (ok && data) {
            this.mainWindow.webContents.send(channel, data);
            console.log(data);
          } else if (!ok && reason) {
            console.warn('error in opening project', reason);
          }
        })
        .catch((err) => {
          console.warn(err);
        });
    }
  }

  handleSaveProject(channel: string): void {
    this.mainWindow.webContents.send(channel, 'Save project functionality');
  }
  setupDevelopmentEnvironment(): void {
    this.mainWindow.webContents.on('context-menu', (_, props) => {
      const { x, y } = props;

      Menu.buildFromTemplate([
        {
          label: 'Inspect element',
          click: () => {
            this.mainWindow.webContents.inspectElement(x, y);
          },
        },
      ]).popup({ window: this.mainWindow });
    });
  }

  // Todo: Can be used to construct a different menu for mac machines.
  // buildDarwinTemplate(): MenuItemConstructorOptions[] {
  //   const subMenuAbout: DarwinMenuItemConstructorOptions = {
  //     label: 'Electron',
  //     submenu: [
  //       {
  //         label: 'About ElectronReact',
  //         selector: 'orderFrontStandardAboutPanel:',
  //       },
  //       { type: 'separator' },
  //       { label: 'Services', submenu: [] },
  //       { type: 'separator' },
  //       {
  //         label: 'Hide ElectronReact',
  //         accelerator: 'Command+H',
  //         selector: 'hide:',
  //       },
  //       {
  //         label: 'Hide Others',
  //         accelerator: 'Command+Shift+H',
  //         selector: 'hideOtherApplications:',
  //       },
  //       { label: 'Show All', selector: 'unhideAllApplications:' },
  //       { type: 'separator' },
  //       {
  //         label: 'Quit',
  //         accelerator: 'Command+Q',
  //         click: () => {
  //           app.quit();
  //         },
  //       },
  //     ],
  //   };
  //   const subMenuEdit: DarwinMenuItemConstructorOptions = {
  //     label: 'Edit',
  //     submenu: [
  //       { label: 'Undo', accelerator: 'Command+Z', selector: 'undo:' },
  //       { label: 'Redo', accelerator: 'Shift+Command+Z', selector: 'redo:' },
  //       { type: 'separator' },
  //       { label: 'Cut', accelerator: 'Command+X', selector: 'cut:' },
  //       { label: 'Copy', accelerator: 'Command+C', selector: 'copy:' },
  //       { label: 'Paste', accelerator: 'Command+V', selector: 'paste:' },
  //       {
  //         label: 'Select All',
  //         accelerator: 'Command+A',
  //         selector: 'selectAll:',
  //       },
  //     ],
  //   };
  //   const subMenuViewDev: MenuItemConstructorOptions = {
  //     label: 'View',
  //     submenu: [
  //       {
  //         label: 'Reload',
  //         accelerator: 'Command+R',
  //         click: () => {
  //           this.mainWindow.webContents.reload();
  //         },
  //       },
  //       {
  //         label: 'Toggle Full Screen',
  //         accelerator: 'Ctrl+Command+F',
  //         click: () => {
  //           this.mainWindow.setFullScreen(!this.mainWindow.isFullScreen());
  //         },
  //       },
  //       {
  //         label: 'Toggle Developer Tools',
  //         accelerator: 'Alt+Command+I',
  //         click: () => {
  //           this.mainWindow.webContents.toggleDevTools();
  //         },
  //       },
  //     ],
  //   };
  //   const subMenuViewProd: MenuItemConstructorOptions = {
  //     label: 'View',
  //     submenu: [
  //       {
  //         label: 'Toggle Full Screen',
  //         accelerator: 'Ctrl+Command+F',
  //         click: () => {
  //           this.mainWindow.setFullScreen(!this.mainWindow.isFullScreen());
  //         },
  //       },
  //     ],
  //   };
  //   const subMenuWindow: DarwinMenuItemConstructorOptions = {
  //     label: 'Window',
  //     submenu: [
  //       {
  //         label: 'Minimize',
  //         accelerator: 'Command+M',
  //         selector: 'performMiniaturize:',
  //       },
  //       { label: 'Close', accelerator: 'Command+W', selector: 'performClose:' },
  //       { type: 'separator' },
  //       { label: 'Bring All to Front', selector: 'arrangeInFront:' },
  //     ],
  //   };
  //   const subMenuHelp: MenuItemConstructorOptions = {
  //     label: 'Help',
  //     submenu: [
  //       {
  //         label: 'Learn More',
  //         click() {
  //           shell.openExternal('https://electronjs.org');
  //         },
  //       },
  //       {
  //         label: 'Documentation',
  //         click() {
  //           shell.openExternal(
  //             'https://github.com/electron/electron/tree/main/docs#readme',
  //           );
  //         },
  //       },
  //       {
  //         label: 'Community Discussions',
  //         click() {
  //           shell.openExternal('https://www.electronjs.org/community');
  //         },
  //       },
  //       {
  //         label: 'Search Issues',
  //         click() {
  //           shell.openExternal('https://github.com/electron/electron/issues');
  //         },
  //       },
  //     ],
  //   };

  //   const subMenuView =
  //     process.env.NODE_ENV === 'development' ||
  //     process.env.DEBUG_PROD === 'true'
  //       ? subMenuViewDev
  //       : subMenuViewProd;

  //   return [subMenuAbout, subMenuEdit, subMenuView, subMenuWindow, subMenuHelp];
  // }

  buildDefaultTemplate() {
    const templateDefault: MenuItemConstructorOptions[] = [
      {
        label: i18n.t('menu:file.label'),
        submenu: [
          {
            label: i18n.t('menu:file.submenu.new'),
            accelerator: 'CmdOrCtrl+N',
            click: () => this.handleProject('project:create'),
          },
          {
            label: i18n.t('menu:file.submenu.open'),
            accelerator: 'CmdOrCtrl+O',
            click: () => this.handleProject('project:open'),
          },
          { label: i18n.t('menu:file.submenu.recentProjects'), submenu: [] },
          { type: 'separator' },
          {
            label: i18n.t('menu:file.submenu.examples.label'),
            submenu: [
              {
                label: i18n.t('menu:file.submenu.examples.submenu.arduino'),
              },
              {
                label: i18n.t('menu:file.submenu.examples.submenu.blink'),
              },
              {
                label: i18n.t('menu:file.submenu.examples.submenu.blinkP1AM'),
              },
              {
                label: i18n.t(
                  'menu:file.submenu.examples.submenu.multiLanguage',
                ),
              },
              {
                label: i18n.t(
                  'menu:file.submenu.examples.submenu.randomGeneratorPragma',
                ),
              },
              {
                label: i18n.t('menu:file.submenu.examples.submenu.tcpSocket'),
              },
              {
                label: i18n.t(
                  'menu:file.submenu.examples.submenu.trafficLightFBD',
                ),
              },
            ],
          },
          { type: 'separator' },
          {
            id: 'test',
            label: i18n.t('menu:file.submenu.save'),
            accelerator: 'CmdOrCtrl+S',
            click: () => this.handleSaveProject('project:save'),
          },
          {
            label: i18n.t('menu:file.submenu.saveAs'),
            accelerator: 'CmdOrCtrl+Shift+S',
          },
          {
            label: i18n.t('menu:file.submenu.closeTab'),
            accelerator: 'CmdOrCtrl+W',
          },
          {
            label: i18n.t('menu:file.submenu.closeProject'),
            accelerator: 'CmdOrCtrl+Shift+W',
          },
          { type: 'separator' },
          {
            label: i18n.t('menu:file.submenu.pageSetup'),
            accelerator: 'CmdOrCtrl+Alt+P',
          },
          {
            label: i18n.t('menu:file.submenu.preview'),
            accelerator: 'CmdOrCtrl+Shift+P',
          },
          {
            label: i18n.t('menu:file.submenu.print'),
            accelerator: 'CmdOrCtrl+P',
          },
          { type: 'separator' },
          {
            label: i18n.t('menu:file.submenu.updates'),
            accelerator: 'CmdOrCtrl+U',
          },
          { type: 'separator' },
          {
            label: i18n.t('menu:file.submenu.quit'),
            role: 'quit',
            accelerator: 'CmdOrCtrl+Q',
          },
        ],
      },
      {
        label: i18n.t('menu:edit.label'),
        submenu: [
          {
            label: i18n.t('menu:edit.submenu.undo'),
            role: 'undo',
          },
          {
            label: i18n.t('menu:edit.submenu.redo'),
            role: 'redo',
            enabled: false,
          },
          { type: 'separator' },
          {
            label: i18n.t('menu:edit.submenu.cut'),
            role: 'cut',
          },
          {
            label: i18n.t('menu:edit.submenu.copy'),
            role: 'copy',
          },
          {
            label: i18n.t('menu:edit.submenu.paste'),
            role: 'paste',
          },
          { type: 'separator' },
          {
            label: i18n.t('menu:edit.submenu.find'),
            accelerator: 'CmdOrCtrl+F',
          },
          {
            label: i18n.t('menu:edit.submenu.findNext'),
            accelerator: 'CmdOrCtrl+K',

            enabled: false,
          },
          {
            label: i18n.t('menu:edit.submenu.findPrevious'),
            accelerator: 'CmdOrCtrl+Shift+K',

            enabled: false,
          },
          { type: 'separator' },
          {
            label: i18n.t('menu:edit.submenu.findInProject'),
            accelerator: 'CmdOrCtrl+Shift+F',
          },
          { type: 'separator' },
          {
            label: i18n.t('menu:edit.submenu.addElement'),
            submenu: [],
          },
          {
            label: i18n.t('menu:edit.submenu.selectAll'),
            role: 'selectAll',
          },
          {
            label: i18n.t('menu:edit.submenu.delete'),
            role: 'delete',
          },
        ],
      },
      {
        label: i18n.t('menu:display.label'),
        submenu: [
          {
            label: i18n.t('menu:display.submenu.refresh'),
            role: 'reload',
          },
          {
            label: i18n.t('menu:display.submenu.clearErrors'),
            accelerator: 'CmdOrCtrl+K',
          },
          { type: 'separator' },
          {
            label: i18n.t('menu:display.submenu.zoom'),
            submenu: [],
          },
          { type: 'separator' },
          {
            label: i18n.t('menu:display.submenu.switchPerspective'),
            accelerator: 'F12',
          },
          {
            label: i18n.t('menu:display.submenu.fullScreen'),
            role: 'togglefullscreen',
          },
          {
            label: i18n.t('menu:display.submenu.resetPerspective'),
          },
          {
            label: i18n.t('menu:display.submenu.sortAlpha'),
          },
          ...(process.env.NODE_ENV === 'development'
            ? this.developOptions
            : []),
        ],
      },
      {
        label: i18n.t('menu:help.label'),
        role: 'help',
        submenu: [
          {
            label: i18n.t('menu:help.submenu.communitySupport'),
          },
          {
            label: i18n.t('menu:help.submenu.about'),
            role: 'about',
          },
        ],
      },
    ];

    return templateDefault;
  }
}
