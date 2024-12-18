/* eslint-disable no-console */
import { BrowserWindow, Menu, MenuItemConstructorOptions, nativeTheme, shell } from 'electron'

import { i18n } from '../utils/i18n'
import { ProjectService } from './services'

/**
 * Wip: Interface for mac machines menu.
 */
interface DarwinMenuItemConstructorOptions extends MenuItemConstructorOptions {
  selector?: string
  submenu?: DarwinMenuItemConstructorOptions[] | Menu
}

/**
 * Class to manage the creation of menu.
 * @class MenuBuilder
 */
export default class MenuBuilder {
  private mainWindow: BrowserWindow;

  private projectService: ProjectService;

  developOptions: MenuItemConstructorOptions[] = [
    { type: 'separator' },
    { role: 'reload' },
    { role: 'forceReload' },
    { role: 'toggleDevTools' },
  ]

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
    this.projectService = new ProjectService(mainWindow);
  }

  async buildMenu(): Promise<Menu> {
    if (process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true') {
      this.setupDevelopmentEnvironment()
    }

    // Todo: Can be used to construct a different menu for mac machines.
    const template =
      process.platform === 'darwin' ? await this.buildDarwinTemplate() : await this.buildDefaultTemplate()

    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)

    return menu
  }

   handleCreateProject() {

    this.mainWindow.webContents.send('project:create-accelerator')
  }

  async handleOpenProject() {
    const response = await this.projectService.openProject()
    this.mainWindow.webContents.send('project:open-accelerator', response)
  }

  handleSaveProject() {
    this.mainWindow.webContents.send('project:save-accelerator')
  }

  async handleGetRecents() {
    const response = await this.projectService.readProjectHistory(this.projectService.getProjectsFilePath())
    return response
  }

  async handleOpenProjectByPath(projectPath: string) {
    const response = await this.projectService.openProjectByPath(projectPath)
    this.mainWindow.webContents.send('project:open-recent-accelerator', response)
  }

  handleCloseTab() {
    this.mainWindow.webContents.send('workspace:close-tab-accelerator')

  }

  handleCloseProject(){
    this.mainWindow.webContents.send('workspace:close-project-accelerator')
  }

  handleDeletePou(){
    this.mainWindow.webContents.send('workspace:delete-pou-accelerator')

  }

  handleSwitchPerspective() {
    this.mainWindow.webContents.send('workspace:switch-perspective-accelerator')
  }
handleOpenExternalLink(link:string) {
 void shell.openExternal(link)
}

handleOpenAboutModal() {
  this.mainWindow.webContents.send('about:open-accelerator')
}

handleFindInProject(){
  this.mainWindow.webContents.send('project:find-in-project-accelerator')
}
  setupDevelopmentEnvironment(): void {
    this.mainWindow.webContents.on('context-menu', (_, props) => {
      const { x, y } = props

      Menu.buildFromTemplate([
        {
          label: 'Inspect element',
          click: () => {
            this.mainWindow.webContents.inspectElement(x, y)
          },
        },
      ]).popup({ window: this.mainWindow })
    })
  }

  updateAppTheme() {
    nativeTheme.themeSource = nativeTheme.shouldUseDarkColors ? 'light' : 'dark'
    this.mainWindow.webContents.send('system:update-theme')
    this.buildMenu()
  }

  // Wip: Constructing a mac machines menu.
  async buildDarwinTemplate(): Promise<MenuItemConstructorOptions[]> {
    const recents = await this.handleGetRecents()
    const homeDir = process.env.HOME || ''
    const defaultDarwinMenu: MenuItemConstructorOptions = {
      role: 'appMenu',
    }

    const subMenuFile: DarwinMenuItemConstructorOptions = {
      label: i18n.t('menu:file.label'),
      submenu: [
        {
          label: i18n.t('menu:file.submenu.new'),
          accelerator: 'Cmd+N',
          click: () => void this.handleCreateProject(),
        },
        {
          label: i18n.t('menu:file.submenu.open'),
          accelerator: 'Cmd+O',
          click: () => void this.handleOpenProject(),
        },
        { type: 'separator' },
        {
          label: i18n.t('menu:file.submenu.save'),
          accelerator: 'Cmd+S',
          click: () => this.handleSaveProject(),
        },
        {
          label: i18n.t('menu:file.submenu.saveAs'),
          accelerator: 'Cmd+Shift+S',
          click: () => {},
        },
        {
          label: i18n.t('menu:file.submenu.closeTab'),
          accelerator: 'Cmd+W',
          click: () => this.handleCloseTab(),
        },
        {
          label: i18n.t('menu:file.submenu.closeProject'),
          accelerator: '',
          click: () => this.handleCloseProject(),
        },
        { type: 'separator' },
        {
          label: i18n.t('menu:file.submenu.pageSetup'),
          accelerator: 'Cmd+Alt+P',
          click: () => console.warn('Page setup button clicked! This is not working yet.'),
        },
        {
          label: i18n.t('menu:file.submenu.preview'),
          accelerator: 'Cmd+Shift+P',
          click: () => console.warn('Preview button clicked! This is not working yet.'),
        },
        {
          label: i18n.t('menu:file.submenu.print'),
          accelerator: 'Cmd+P',
          enabled: false,
        },
        { type: 'separator' },
        {
          label: i18n.t('menu:file.submenu.updates'),
          accelerator: 'Cmd+U',
          click: () => console.warn('Updates button clicked! This is not working yet.'),
        },
        { type: 'separator' },
        {
          label: i18n.t('menu:file.submenu.quit'),
          role: 'quit',
          accelerator: 'Cmd+Q',
        },
      ],
    }

    const subMenuEdit: DarwinMenuItemConstructorOptions = {
      label: i18n.t('menu:edit.label'),
      submenu: [
        {
          label: i18n.t('menu:edit.submenu.undo'),
          accelerator: 'Cmd+Z',
          selector: 'undo:',
        },
        {
          label: i18n.t('menu:edit.submenu.redo'),
          accelerator: 'Cmd+Y',
          selector: 'redo:',
        },
        { type: 'separator' },
        {
          label: i18n.t('menu:edit.submenu.cut'),
          accelerator: 'Cmd+X',
          selector: 'cut:',
        },
        {
          label: i18n.t('menu:edit.submenu.copy'),
          accelerator: 'Cmd+C',
          selector: 'copy:',
        },
        {
          label: i18n.t('menu:edit.submenu.paste'),
          accelerator: 'Cmd+V',
          selector: 'paste:',
        },
        { type: 'separator' },
        {
          label: i18n.t('menu:edit.submenu.find'),
          accelerator: 'Cmd+F',
          selector: 'find:',
        },
        {
          label: i18n.t('menu:edit.submenu.findNext'),
          accelerator: 'Cmd+K',
        },
        {
          label: i18n.t('menu:edit.submenu.findPrevious'),
          accelerator: 'Cmd+Shift+K',
        },
        { type: 'separator' },
        {
          label: i18n.t('menu:edit.submenu.findInProject'),
          accelerator: '',
          click: () => this.handleFindInProject(),
        },
        { type: 'separator' },
        {
          label: i18n.t('menu:edit.submenu.addElement.label'),
          submenu: [
            {
              label: i18n.t('menu:edit.submenu.addElement.submenu.functionBlock'),
            },
            {
              label: i18n.t('menu:edit.submenu.addElement.submenu.function'),
            },
            {
              label: i18n.t('menu:edit.submenu.addElement.submenu.program'),
            },
            {
              label: i18n.t('menu:edit.submenu.addElement.submenu.dataType'),
            },
          ],
        },
        {
          label: i18n.t('menu:edit.submenu.selectAll'),
          accelerator: 'Cmd+A',
          selector: 'selectAll:',
        },
        {
          label: i18n.t('menu:edit.submenu.deletePou'),
          accelerator: 'Cmd+backspace',
          // role: 'delete',
          click: () => this.handleDeletePou(),
        },
      ],
    }

    const subMenuDisplay: DarwinMenuItemConstructorOptions = {
      label: i18n.t('menu:display.label'),
      submenu: [
        {
          label: i18n.t('menu:display.submenu.refresh'),
          accelerator: 'Cmd+R',
          selector: 'reload:',
        },
        {
          label: i18n.t('menu:display.submenu.clearErrors'),
          accelerator: '',
        },
        { type: 'separator' },
        {
          label: 'Zoom', // Todo: i18n.t('menu:display.submenu.zoom') have to be added
          submenu: [
            {
              label: i18n.t('menu:display.submenu.zoomIn'),
              accelerator: 'Cmd+Plus',
            },
            {
              label: i18n.t('menu:display.submenu.zoomOut'),
              accelerator: 'Cmd+-',
            },
          ],
        },
        { type: 'separator' },
        {
          label: i18n.t('menu:display.submenu.switchPerspective'),
          accelerator: 'F12',
          click: () => this.handleSwitchPerspective(),
        },
        {
          label: i18n.t('menu:display.submenu.fullScreen'),
          accelerator: 'Shift+F12',
          role: 'togglefullscreen',
        },
        {
          label: i18n.t('menu:display.submenu.resetPerspective'),
        },
        {
          label: i18n.t('menu:display.submenu.sortAlpha'),
        },
        {
          type: 'separator',
        },
        {
          label: i18n.t('menu:display.submenu.theme'),
          sublabel: nativeTheme.shouldUseDarkColors ? 'Dark' : 'Light',
          click: () => this.updateAppTheme(),
        },
      ],
    }

    const subMenuRecent: DarwinMenuItemConstructorOptions = {
      label: i18n.t('menu:recents'),
      submenu: recents.map((projectEntry) => {
        const projectPath = projectEntry.path.startsWith(homeDir)
          ? projectEntry.path.replace(homeDir, '~')
          : projectEntry.path

        return {
          label: projectPath,
          click: () => {
            this.handleOpenProjectByPath(projectEntry.path)
            console.log('Opened project from path:', projectEntry.path)
          },
        }
      }),
    }

    const subMenuHelp: DarwinMenuItemConstructorOptions = {
      label: i18n.t('menu:help.label'),
      submenu: [
        {
          label: i18n.t('menu:help.submenu.communitySupport'),
          accelerator: 'F1',
          click: () => void this.handleOpenExternalLink('https://openplc.discussion.community/'),
        },
        {
          label: i18n.t('menu:help.submenu.about'),
          accelerator: 'F1',
          click: () => void this.handleOpenAboutModal(),
        },
      ],
    }

    return [defaultDarwinMenu,subMenuFile, subMenuEdit, subMenuDisplay, subMenuHelp, subMenuRecent]
  }

  // Wip: Constructing a default machines menu.
  async buildDefaultTemplate() {
    const recents = await this.handleGetRecents()
    const homeDir = process.env.HOME || ''
    const templateDefault: MenuItemConstructorOptions[] = [
      {
        label: i18n.t('menu:file.label'),
        visible: false,
        submenu: [
          {
            label: i18n.t('menu:file.submenu.new'),
            accelerator: 'Ctrl+N',
            click: () => this.handleCreateProject(),
          },
          {
            label: i18n.t('menu:file.submenu.open'),
            accelerator: 'Ctrl+O',
            click: () => void this.handleOpenProject(),
          },
             {
            type: 'separator',
          },
          {
            label: i18n.t('menu:file.submenu.save'),
            accelerator: 'Ctrl+S',
            click: () => this.handleSaveProject(),
          },
          {
            label: i18n.t('menu:file.submenu.saveAs'),
            accelerator: 'Ctrl+Shift+S',
          },
          {
            label: i18n.t('menu:file.submenu.closeTab'),

            accelerator: 'Ctrl+W',
            click: () => this.handleCloseTab(),
          },
          {
            label: i18n.t('menu:file.submenu.closeProject'),
            accelerator: 'Ctrl+Shift+W',
            click: () => this.handleCloseProject(),
          },
          {
            type: 'separator',
          },
          {
            label: i18n.t('menu:file.submenu.pageSetup'),
            enabled: false,
            accelerator: 'Ctrl+Alt+P',
            click: () => console.warn('Menu button clicked! This is not working yet.'),
          },
          {
            label: i18n.t('menu:file.submenu.preview'),
            enabled: false,
            accelerator: 'Ctrl+Shift+P',
            click: () => console.warn('Menu button clicked! This is not working yet.'),
          },
          {
            label: i18n.t('menu:file.submenu.print'),
            accelerator: 'Ctrl+P',
            enabled: false,
          },
          { type: 'separator' },
          {
            label: i18n.t('menu:file.submenu.updates'),
            enabled: false,
            accelerator: 'Ctrl+U',
            click: () => console.warn('Menu button clicked! This is not working yet.'),
          },
          { type: 'separator' },
          {
            label: i18n.t('menu:file.submenu.quit'),
            role: 'quit',
            accelerator: 'Ctrl+Q',
          },
        ],
      },
      {
        label: i18n.t('menu:edit.label'),
        submenu: [
          {
            label: i18n.t('menu:edit.submenu.undo'),
            enabled: false,
            accelerator: 'Ctrl+Z',
            role: 'undo',
          },
          {
            label: i18n.t('menu:edit.submenu.redo'),
            enabled: false,
            accelerator: 'Ctrl+Y',
            role: 'redo',
          },
          { type: 'separator' },
          {
            label: i18n.t('menu:edit.submenu.cut'),
            enabled: false,
            accelerator: 'Ctrl+X',
            role: 'cut',
          },
          {
            label: i18n.t('menu:edit.submenu.copy'),
            enabled: false,
            accelerator: 'Ctrl+C',
            role: 'copy',
          },
          {
            label: i18n.t('menu:edit.submenu.paste'),
            enabled: false,
            accelerator: 'Ctrl+V',
            role: 'paste',
          },
          { type: 'separator' },
          {
            label: i18n.t('menu:edit.submenu.find'),
            enabled: false,
            accelerator: 'Ctrl+F',
          },
          {
            label: i18n.t('menu:edit.submenu.findNext'),
            accelerator: 'Ctrl+K',
            enabled: false,
          },
          {
            label: i18n.t('menu:edit.submenu.findPrevious'),
            accelerator: 'Ctrl+Shift+K',
            enabled: false,
          },
          { type: 'separator' },
          {
            label: i18n.t('menu:edit.submenu.findInProject'),
            accelerator: 'Ctrl+Shift+F',
            click: () => this.handleFindInProject(),
          },
          { type: 'separator' },
          {
            label: i18n.t('menu:edit.submenu.addElement.label'),
            enabled: false,
            submenu: [
              {
                label: i18n.t('menu:edit.submenu.addElement.submenu.functionBlock'),
              },
              {
                label: i18n.t('menu:edit.submenu.addElement.submenu.function'),
              },
              {
                label: i18n.t('menu:edit.submenu.addElement.submenu.program'),
              },
              {
                label: i18n.t('menu:edit.submenu.addElement.submenu.dataType'),
              },
            ],
          },
          {
            label: i18n.t('menu:edit.submenu.selectAll'),
            enabled: false,
            accelerator: 'Ctrl+A',
            role: 'selectAll',
          },
          {
            label: i18n.t('menu:edit.submenu.deletePou'),
            accelerator:"Ctrl+Shift+delete",
            click: () => this.handleDeletePou(),
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
            enabled: false,
            accelerator: '',
          },
          { type: 'separator' },
          {
            label: 'Zoom',
            enabled: false,
            submenu: [
              {
                label: i18n.t('menu:display.submenu.zoomIn'),
                accelerator: 'Ctrl+Plus',
              },
              {
                label: i18n.t('menu:display.submenu.zoomOut'),
                accelerator: 'Ctrl+-',
              },
            ],
          },
          { type: 'separator' },
          {
            label: i18n.t('menu:display.submenu.switchPerspective'),
            accelerator: 'F12',
            click: () => this.handleSwitchPerspective(),
          },
          {
            label: i18n.t('menu:display.submenu.fullScreen'),
            role: 'togglefullscreen',
          },
          {
            label: i18n.t('menu:display.submenu.resetPerspective'),
            enabled: false,
          },
          {
            label: i18n.t('menu:display.submenu.sortAlpha'),
            enabled: false,
          },
          {
            type: 'separator',
          },
          {
            label: i18n.t('menu:display.submenu.theme'),
            sublabel: nativeTheme.shouldUseDarkColors ? 'Dark' : 'Light',
            click: () => this.updateAppTheme(),
          },
        ],
      },
      {
        label: i18n.t('menu:help.label'),
        role: 'help',
        submenu: [
          {
            label: i18n.t('menu:help.submenu.communitySupport'),
            accelerator: 'F1',
            click: () => void this.handleOpenExternalLink('https://openplc.discussion.community/'),
          },
          {
            label: i18n.t('menu:help.submenu.about'),
            accelerator : 'F1',
            click: () => this.handleOpenAboutModal(),
          },
        ],
      },

      {
        label: i18n.t('menu:recents'),
        submenu: recents.map((projectEntry) => {
          const projectPath = projectEntry.path.startsWith(homeDir)
            ? projectEntry.path.replace(homeDir, '~')
            : projectEntry.path

          return {
            label: projectPath,
            click: () => {
              this.handleOpenProjectByPath(projectEntry.path)
              console.log('Opened project from path:', projectEntry.path)
            },
          }
        }),
      },
    ]

    return templateDefault
  }
}
