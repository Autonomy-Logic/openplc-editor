import { i18n } from '@root/frontend/locales/i18n'
import { BrowserWindow, Menu, MenuItemConstructorOptions, nativeTheme, shell } from 'electron'

import { ProjectService } from '../backend/editor/services'
import { store } from './modules/store'

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
  private mainWindow: BrowserWindow
  private projectService: ProjectService
  private readonly handleDevelopmentContextMenu = (_: Electron.Event, props: Electron.ContextMenuParams): void => {
    if (!this.hasLiveWindow()) return

    const { x, y } = props

    Menu.buildFromTemplate([
      {
        label: 'Inspect element',
        click: () => {
          if (!this.hasLiveWindow()) return
          this.mainWindow.webContents.inspectElement(x, y)
        },
      },
    ]).popup({ window: this.mainWindow })
  }

  developOptions: MenuItemConstructorOptions[] = [
    { type: 'separator' },
    { role: 'reload' },
    { role: 'forceReload' },
    { role: 'toggleDevTools' },
  ]

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow
    this.projectService = new ProjectService(mainWindow)
  }

  private hasLiveWindow(): boolean {
    return !this.mainWindow.isDestroyed()
  }

  private getFallbackMenu(): Menu {
    return Menu.getApplicationMenu() ?? Menu.buildFromTemplate([])
  }

  async buildMenu(): Promise<Menu> {
    if (!this.hasLiveWindow()) {
      return this.getFallbackMenu()
    }

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

  sendOpenRequest() {
    this.mainWindow.webContents.send('project:open-project-request')
  }

  handleSaveProject() {
    this.mainWindow.webContents.send('project:save-accelerator')
  }

  handleSaveFile() {
    this.mainWindow.webContents.send('project:save-file-accelerator')
  }

  handleExportProjectRequest(xmlFormatTarget: 'old-editor' | 'codesys') {
    this.mainWindow.webContents.send('compiler:export-project-request', xmlFormatTarget)
  }

  async handleGetRecent() {
    const response = await this.projectService.readProjectHistory(this.projectService.getHistoryProjectsFilePath())
    return response
  }

  async handleOpenProjectByPath(projectPath: string) {
    const response = await this.projectService.openProjectByPath(projectPath)
    this.mainWindow.webContents.send('project:open-recent-accelerator', response)
  }

  handleCloseTab() {
    this.mainWindow.webContents.send('workspace:close-tab-accelerator')
  }

  handleCloseProject() {
    this.mainWindow.webContents.send('workspace:close-project-accelerator')
  }

  handleDeletePou() {
    this.mainWindow.webContents.send('workspace:delete-file-accelerator')
  }

  handleSwitchPerspective() {
    this.mainWindow.webContents.send('workspace:switch-perspective-accelerator')
  }

  async handleOpenExternalLink(link: string) {
    try {
      await shell.openExternal(link)
    } catch (error) {
      console.error('Failed to open external link:', error)
      this.mainWindow.webContents.send('error:external-link', {
        message: 'Failed to open external link',
        error,
      })
    }
  }

  handleOpenAboutModal() {
    this.mainWindow.webContents.send('about:open-accelerator')
  }

  handleFindInProject() {
    this.mainWindow.webContents.send('project:find-in-project-accelerator')
  }

  handleQuitAppRequest() {
    this.mainWindow.webContents.send('window-controls:request-close')
  }

  handleUndoRequest() {
    this.mainWindow.webContents.send('edit:undo-request')
  }
  handleRedoRequest() {
    this.mainWindow.webContents.send('edit:redo-request')
  }

  /**
   * --------------------------------------------------------------------------------------------
   */

  setupDevelopmentEnvironment(): void {
    if (!this.hasLiveWindow()) return

    this.mainWindow.webContents.removeListener('context-menu', this.handleDevelopmentContextMenu)
    this.mainWindow.webContents.on('context-menu', this.handleDevelopmentContextMenu)
  }

  /** Theme order for the Display ▸ Change Theme cycle: Light → Dark → 90's. */
  private static readonly THEME_ORDER = ['light', 'dark', 'nineties'] as const

  /** Current persisted theme, falling back to the OS preference. */
  private currentTheme(): 'light' | 'dark' | 'nineties' {
    const stored = store.get('theme')
    if (stored === 'dark' || stored === 'light' || stored === 'nineties') return stored
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }

  /** Sublabel shown next to the Change Theme menu item. */
  private themeSublabel(): string {
    const t = this.currentTheme()
    return t === 'nineties' ? "90's" : t === 'dark' ? 'Dark' : 'Light'
  }

  updateAppTheme() {
    const order = MenuBuilder.THEME_ORDER
    const newTheme = order[(order.indexOf(this.currentTheme()) + 1) % order.length] ?? 'light'
    // nativeTheme only models light/dark; the 90's skin is UI-only and rides on
    // a light base, so don't drive a dark OS theme for it.
    nativeTheme.themeSource = newTheme === 'dark' ? 'dark' : 'light'
    store.set('theme', newTheme)
    if (this.hasLiveWindow()) {
      // Send the explicit theme name so the renderer applies light / dark / 90's
      // (the legacy no-payload signal just toggled light<->dark).
      this.mainWindow.webContents.send('system:update-theme', newTheme)
    }
    void this.buildMenu().catch((error) => {
      console.error('Error rebuilding application menu:', error)
    })
  }

  /**
   * Menu construction -------------------------------------------------------
   */
  /**
   * Construct a menu instance for OXS.
   */
  async buildDarwinTemplate(): Promise<MenuItemConstructorOptions[]> {
    const recent = await this.handleGetRecent()
    const homeDir = process.env.HOME || ''
    const defaultDarwinMenu: MenuItemConstructorOptions = {
      role: 'appMenu',
    }

    const subMenuFile: DarwinMenuItemConstructorOptions = {
      label: i18n.t('menu:file.label'),
      submenu: [
        {
          label: i18n.t('menu:file.submenu.newProject'),
          accelerator: 'Cmd+N',
          click: () => void this.handleCreateProject(),
        },
        {
          label: i18n.t('menu:file.submenu.openProject'),
          accelerator: 'Cmd+O',
          click: () => this.sendOpenRequest(),
        },
        { type: 'separator' },
        {
          label: i18n.t('menu:file.submenu.save'),
          accelerator: 'Cmd+S',
          click: () => this.handleSaveFile(),
        },
        {
          label: i18n.t('menu:file.submenu.saveProject'),
          accelerator: 'Cmd+Shift+S',
          click: () => this.handleSaveProject(),
        },
        {
          label: i18n.t('menu:file.submenu.saveAs'),
          accelerator: 'Cmd+Shift+A',
          click: () => {},
          enabled: false,
        },
        {
          label: i18n.t('menu:file.submenu.closeTab'),
          accelerator: 'Cmd+W',
          click: () => this.handleCloseTab(),
        },
        {
          label: i18n.t('menu:file.submenu.closeProject'),
          accelerator: 'Cmd+Shift+W',
          click: () => this.handleCloseProject(),
        },
        { type: 'separator' },
        {
          label: i18n.t('menu:file.submenu.exportToPLCOpenXml'),
          click: () => this.handleExportProjectRequest('old-editor'),
        },
        {
          label: i18n.t('menu:file.submenu.exportToCodesysXml'),
          click: () => this.handleExportProjectRequest('codesys'),
        },
        { type: 'separator' },
        {
          label: i18n.t('menu:file.submenu.pageSetup'),
          accelerator: 'Cmd+Option+P',
          enabled: false,
        },
        {
          label: i18n.t('menu:file.submenu.preview'),
          accelerator: 'Cmd+Shift+P',
          enabled: false,
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
          enabled: false,
        },
        { type: 'separator' },
        {
          label: 'Board Package Manager...',
          click: () => this.mainWindow.webContents.send('packages:open-manager'),
        },
      ],
    }

    const subMenuEdit: DarwinMenuItemConstructorOptions = {
      label: i18n.t('menu:edit.label'),
      submenu: [
        {
          label: i18n.t('menu:edit.submenu.undo'),
          accelerator: 'Cmd+Z',
          click: () => this.handleUndoRequest(),
        },
        {
          label: i18n.t('menu:edit.submenu.redo'),
          accelerator: 'Cmd+Shift+Z',
          click: () => this.handleRedoRequest(),
        },
        { type: 'separator' },
        {
          label: i18n.t('menu:edit.submenu.cut'),
          accelerator: 'Cmd+X',
          selector: 'cut:',
          enabled: true,
        },
        {
          label: i18n.t('menu:edit.submenu.copy'),
          accelerator: 'Cmd+C',
          selector: 'copy:',
          enabled: true,
        },
        {
          label: i18n.t('menu:edit.submenu.paste'),
          accelerator: 'Cmd+V',
          selector: 'paste:',
          enabled: true,
        },
        { type: 'separator' },
        {
          label: i18n.t('menu:edit.submenu.find'),
          accelerator: 'Cmd+F',
          selector: 'find:',
          enabled: false,
        },
        {
          label: i18n.t('menu:edit.submenu.findNext'),
          accelerator: 'Cmd+K',
          enabled: false,
        },
        {
          label: i18n.t('menu:edit.submenu.findPrevious'),
          accelerator: 'Cmd+Shift+K',
          enabled: false,
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
          accelerator: 'Cmd+A',
          selector: 'selectAll:',
          enabled: false,
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
          enabled: false,
        },
        {
          label: i18n.t('menu:display.submenu.clearErrors'),
          accelerator: '',
          enabled: false,
        },
        { type: 'separator' },
        {
          label: 'Zoom', // Todo: i18n.t('menu:display.submenu.zoom') have to be added
          enabled: false,
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
          label: i18n.t('menu:display.submenu.sortAlpha'),
          enabled: false,
        },
        {
          type: 'separator',
        },
        {
          label: i18n.t('menu:display.submenu.theme'),
          sublabel: this.themeSublabel(),
          click: () => this.updateAppTheme(),
        },
      ],
    }

    const subMenuRecent: DarwinMenuItemConstructorOptions = {
      label: i18n.t('menu:recent'),
      submenu: recent.map((projectEntry) => {
        const projectPath = projectEntry.path.startsWith(homeDir)
          ? projectEntry.path.replace(homeDir, '~')
          : projectEntry.path
        const projectName = projectEntry.name

        return {
          label: `${projectName} (${projectPath})`,
          click: () => {
            void this.handleOpenProjectByPath(projectEntry.path)
          },
        }
      }),
    }

    const subMenuHelp: DarwinMenuItemConstructorOptions = {
      label: i18n.t('menu:help.label'),
      submenu: [
        {
          label: i18n.t('menu:help.submenu.communitySupport'),
          click: () => void this.handleOpenExternalLink('https://openplc.discussion.community/'),
        },
        {
          label: i18n.t('menu:help.submenu.documentation'),
          click: () => void this.handleOpenExternalLink('https://edge.autonomylogic.com/docs'),
        },
        {
          label: i18n.t('menu:help.submenu.about'),
          accelerator: 'F1',
          click: () => void this.handleOpenAboutModal(),
        },
      ],
    }

    return [defaultDarwinMenu, subMenuFile, subMenuEdit, subMenuDisplay, subMenuHelp, subMenuRecent]
  }

  /**
   * Construct a default menu instance.
   */
  async buildDefaultTemplate() {
    const recent = await this.handleGetRecent()
    const homeDir = process.env.HOME || ''
    const templateDefault: MenuItemConstructorOptions[] = [
      {
        label: i18n.t('menu:file.label'),
        visible: false,
        submenu: [
          {
            label: i18n.t('menu:file.submenu.newProject'),
            accelerator: 'Ctrl+N',
            click: () => this.handleCreateProject(),
          },
          {
            label: i18n.t('menu:file.submenu.openProject'),
            accelerator: 'Ctrl+O',
            click: () => this.sendOpenRequest(),
          },
          {
            type: 'separator',
          },
          {
            label: i18n.t('menu:file.submenu.save'),
            accelerator: 'Ctrl+S',
            click: () => this.handleSaveFile(),
          },
          {
            label: i18n.t('menu:file.submenu.saveProject'),
            accelerator: 'Ctrl+Shift+S',
            click: () => this.handleSaveProject(),
          },
          {
            label: i18n.t('menu:file.submenu.saveAs'),
            accelerator: 'Ctrl+Shift+A',
            enabled: false,
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
            label: i18n.t('menu:file.submenu.exportToPLCOpenXml'),
            click: () => this.handleExportProjectRequest('old-editor'),
          },
          {
            label: i18n.t('menu:file.submenu.exportToCodesysXml'),
            click: () => this.handleExportProjectRequest('codesys'),
          },
          {
            type: 'separator',
          },
          {
            label: i18n.t('menu:file.submenu.pageSetup'),
            enabled: false,
            accelerator: 'Ctrl+Alt+P',
          },
          {
            label: i18n.t('menu:file.submenu.preview'),
            enabled: false,
            accelerator: 'Ctrl+Shift+P',
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
          },
          { type: 'separator' },
          {
            label: 'Board Package Manager...',
            click: () => this.mainWindow.webContents.send('packages:open-manager'),
          },
          { type: 'separator' },
          {
            label: i18n.t('menu:file.submenu.quit'),
            // role: 'quit',
            accelerator: 'Ctrl+Q',
            click: () => this.handleQuitAppRequest(),
          },
        ],
      },
      {
        label: i18n.t('menu:edit.label'),
        submenu: [
          {
            label: i18n.t('menu:edit.submenu.undo'),
            accelerator: 'Ctrl+Z',
            click: () => this.handleUndoRequest(),
          },
          {
            label: i18n.t('menu:edit.submenu.redo'),
            accelerator: 'Ctrl+Shift+Z',
            click: () => this.handleRedoRequest(),
          },
          { type: 'separator' },
          {
            label: i18n.t('menu:edit.submenu.cut'),
            enabled: true,
            accelerator: 'Ctrl+X',
            role: 'cut',
          },
          {
            label: i18n.t('menu:edit.submenu.copy'),
            enabled: true,
            accelerator: 'Ctrl+C',
            role: 'copy',
          },
          {
            label: i18n.t('menu:edit.submenu.paste'),
            enabled: true,
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
            accelerator: 'Ctrl+Shift+delete',
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
            enabled: false,
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
            label: i18n.t('menu:display.submenu.sortAlpha'),
            enabled: false,
          },
          {
            type: 'separator',
          },
          {
            label: i18n.t('menu:display.submenu.theme'),
            sublabel: this.themeSublabel(),
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
            click: () => void this.handleOpenExternalLink('https://openplc.discussion.community/'),
          },
          {
            label: i18n.t('menu:help.submenu.documentation'),
            click: () => void this.handleOpenExternalLink('https://edge.autonomylogic.com/docs'),
          },
          {
            label: i18n.t('menu:help.submenu.about'),
            accelerator: 'F1',
            click: () => this.handleOpenAboutModal(),
          },
        ],
      },

      {
        label: i18n.t('menu:recent'),
        submenu: recent.map((projectEntry) => {
          const projectPath = projectEntry.path.startsWith(homeDir)
            ? projectEntry.path.replace(homeDir, '~')
            : projectEntry.path
          const projectName = projectEntry.name

          return {
            label: `${projectName} (${projectPath})`,
            click: () => {
              void this.handleOpenProjectByPath(projectEntry.path)
            },
          }
        }),
      },
    ]

    return templateDefault
  }
}
