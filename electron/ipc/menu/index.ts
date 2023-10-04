import { ipcMain, Menu, MenuItemConstructorOptions } from 'electron'

import { CONSTANTS } from '../../../shared/constants'
import { i18n } from '../../../shared/i18n'
import { click, handleCreateProject, handleSaveProject } from './actions'

type GetTemplate = {
  hasProject?: boolean
}

const {
  channels: { set },
} = CONSTANTS

const developOptions: MenuItemConstructorOptions[] = [
  { type: 'separator' },
  { role: 'reload' },
  { role: 'forceReload' },
  { role: 'toggleDevTools' },
]

/**
 * Generates the menu template based on provided options.
 * @param options - Menu options.
 * @returns The generated menu template.
 */
const getTemplate = (options?: GetTemplate): MenuItemConstructorOptions[] => {
  const { hasProject = false } = options || ({} as GetTemplate)
  return [
    {
      label: i18n.t('menu:file.label'),
      submenu: [
        {
          label: i18n.t('menu:file.submenu.new'),
          accelerator: 'CmdOrCtrl+N',
          click: handleCreateProject,
        },
        {
          label: i18n.t('menu:file.submenu.open'),
          accelerator: 'CmdOrCtrl+O',
          click,
        },
        { label: i18n.t('menu:file.submenu.recentProjects'), submenu: [] },
        { type: 'separator' },
        {
          label: i18n.t('menu:file.submenu.examples.label'),
          submenu: [
            {
              label: i18n.t('menu:file.submenu.examples.submenu.arduino'),
              click,
            },
            {
              label: i18n.t('menu:file.submenu.examples.submenu.blink'),
              click,
            },
            {
              label: i18n.t('menu:file.submenu.examples.submenu.blinkP1AM'),
              click,
            },
            {
              label: i18n.t('menu:file.submenu.examples.submenu.multiLanguage'),
              click,
            },
            {
              label: i18n.t(
                'menu:file.submenu.examples.submenu.randomGeneratorPragma',
              ),
              click,
            },
            {
              label: i18n.t('menu:file.submenu.examples.submenu.tcpSocket'),
              click,
            },
            {
              label: i18n.t(
                'menu:file.submenu.examples.submenu.trafficLightFBD',
              ),
              click,
            },
          ],
        },
        { type: 'separator' },
        {
          id: 'test',
          label: i18n.t('menu:file.submenu.save'),
          accelerator: 'CmdOrCtrl+S',
          click: handleSaveProject,
          enabled: hasProject,
        },
        {
          label: i18n.t('menu:file.submenu.saveAs'),
          accelerator: 'CmdOrCtrl+Shift+S',
          click,
          enabled: hasProject,
        },
        {
          label: i18n.t('menu:file.submenu.closeTab'),
          accelerator: 'CmdOrCtrl+W',
          click,
          enabled: hasProject,
        },
        {
          label: i18n.t('menu:file.submenu.closeProject'),
          accelerator: 'CmdOrCtrl+Shift+W',
          click,
          enabled: hasProject,
        },
        { type: 'separator' },
        {
          label: i18n.t('menu:file.submenu.pageSetup'),
          accelerator: 'CmdOrCtrl+Alt+P',
          click,
          enabled: hasProject,
        },
        {
          label: i18n.t('menu:file.submenu.preview'),
          accelerator: 'CmdOrCtrl+Shift+P',
          click,
          enabled: hasProject,
        },
        {
          label: i18n.t('menu:file.submenu.print'),
          accelerator: 'CmdOrCtrl+P',
          click,
          enabled: hasProject,
        },
        { type: 'separator' },
        {
          label: i18n.t('menu:file.submenu.updates'),
          accelerator: 'CmdOrCtrl+U',
          click,
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
          enabled: hasProject,
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
          enabled: hasProject,
        },
        {
          label: i18n.t('menu:edit.submenu.copy'),
          role: 'copy',
          enabled: hasProject,
        },
        {
          label: i18n.t('menu:edit.submenu.paste'),
          role: 'paste',
          enabled: hasProject,
        },
        { type: 'separator' },
        {
          label: i18n.t('menu:edit.submenu.find'),
          accelerator: 'CmdOrCtrl+F',
          click,
          enabled: hasProject,
        },
        {
          label: i18n.t('menu:edit.submenu.findNext'),
          accelerator: 'CmdOrCtrl+K',
          click,
          enabled: false,
        },
        {
          label: i18n.t('menu:edit.submenu.findPrevious'),
          accelerator: 'CmdOrCtrl+Shift+K',
          click,
          enabled: false,
        },
        { type: 'separator' },
        {
          label: i18n.t('menu:edit.submenu.findInProject'),
          accelerator: 'CmdOrCtrl+Shift+F',
          click,
          enabled: hasProject,
        },
        { type: 'separator' },
        {
          label: i18n.t('menu:edit.submenu.addElement'),
          submenu: [],
          enabled: hasProject,
        },
        {
          label: i18n.t('menu:edit.submenu.selectAll'),
          role: 'selectAll',
          enabled: hasProject,
        },
        {
          label: i18n.t('menu:edit.submenu.delete'),
          role: 'delete',
          enabled: hasProject,
        },
      ],
    },
    {
      label: i18n.t('menu:display.label'),
      submenu: [
        {
          label: i18n.t('menu:display.submenu.refresh'),
          role: 'reload',
          enabled: hasProject,
        },
        {
          label: i18n.t('menu:display.submenu.clearErrors'),
          accelerator: 'CmdOrCtrl+K',
          click,
          enabled: hasProject,
        },
        { type: 'separator' },
        {
          label: i18n.t('menu:display.submenu.zoom'),
          enabled: hasProject,
          submenu: [],
        },
        { type: 'separator' },
        {
          label: i18n.t('menu:display.submenu.switchPerspective'),
          accelerator: 'F12',
          click,
        },
        {
          label: i18n.t('menu:display.submenu.fullScreen'),
          role: 'togglefullscreen',
        },
        {
          label: i18n.t('menu:display.submenu.resetPerspective'),
          click,
        },
        {
          label: i18n.t('menu:display.submenu.sortAlpha'),
          click,
        },
        ...(process.env.VITE_DEV_SERVER_URL ? developOptions : []),
      ],
    },
    {
      label: i18n.t('menu:help.label'),
      role: 'help',
      submenu: [
        {
          label: i18n.t('menu:help.submenu.communitySupport'),
          click,
        },
        {
          label: i18n.t('menu:help.submenu.about'),
          role: 'about',
        },
      ],
    },
  ]
}

/**
 * Creates the application menu from the template and sets it.
 */
export const menu = {
  createMenu: () => {
    const template = getTemplate()
    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)
  },
}
/**
 * Sets up IPC event handling for menu-related actions.
 */
export const menuIpc = () => {
  /**
   * Handles the IPC event to update the menu with project-related options.
   */
  ipcMain.handle(set.UPDATE_MENU_PROJECT, async () => {
    const template = getTemplate({ hasProject: true })
    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)
    return { ok: true }
  })
}
