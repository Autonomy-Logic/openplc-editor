import { i18n } from '@shared/i18n';
import { Menu, MenuItemConstructorOptions, shell } from 'electron';

import { CreateNewProjectController } from '../controllers';

export const createMenu = () => {
  const createNewProjectController = new CreateNewProjectController();
  const template: MenuItemConstructorOptions[] = [
    {
      label: i18n.t('menu:file.label'),
      submenu: [
        {
          label: i18n.t('menu:file.submenu.new'),

          accelerator: 'CmdOrCtrl+N',
          click: createNewProjectController.handle,
        },
        {
          label: i18n.t('menu:file.submenu.open'),

          accelerator: 'CmdOrCtrl+O',
          click: () => {
            console.log('Will be implemented soon');
          },
        },
        { label: i18n.t('menu:file.submenu.recentProjects'), submenu: [] },
        { type: 'separator' },
        {
          label: i18n.t('menu:file.submenu.examples.label'),
          submenu: [
            {
              label: i18n.t('menu:file.submenu.examples.submenu.arduino'),
              click: () => {
                console.log('Will be implemented soon');
              },
            },
            {
              label: i18n.t('menu:file.submenu.examples.submenu.blink'),
              click: () => {
                console.log('Will be implemented soon');
              },
            },
            {
              label: i18n.t('menu:file.submenu.examples.submenu.blinkP1AM'),
              click: () => {
                console.log('Will be implemented soon');
              },
            },
            {
              label: i18n.t('menu:file.submenu.examples.submenu.multiLanguage'),
              click: () => {
                console.log('Will be implemented soon');
              },
            },
            {
              label: i18n.t('menu:file.submenu.examples.submenu.randomGeneratorPragma'),
              click: () => {
                console.log('Will be implemented soon');
              },
            },
            {
              label: i18n.t('menu:file.submenu.examples.submenu.tcpSocket'),
              click: () => {
                console.log('Will be implemented soon');
              },
            },
            {
              label: i18n.t('menu:file.submenu.examples.submenu.trafficLightFBD'),
              click: () => {
                console.log('Will be implemented soon');
              },
            },
          ],
        },
        { type: 'separator' },
        {
          label: i18n.t('menu:file.submenu.save'),
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            console.log('Will be implemented soon');
          },
        },
        {
          label: i18n.t('menu:file.submenu.saveAs'),
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => {
            console.log('Will be implemented soon');
          },
        },
        {
          label: i18n.t('menu:file.submenu.closeTab'),
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            console.log('Will be implemented soon');
          },
        },
        {
          label: i18n.t('menu:file.submenu.closeProject'),
          accelerator: 'CmdOrCtrl+Shift+W',
          click: () => {
            console.log('Will be implemented soon');
          },
        },
        { type: 'separator' },
        {
          label: i18n.t('menu:file.submenu.pageSetup'),
          accelerator: 'CmdOrCtrl+Alt+P',
          click: () => {
            console.log('Will be implemented soon');
          },
        },
        {
          label: i18n.t('menu:file.submenu.preview'),
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => {
            console.log('Will be implemented soon');
          },
        },
        {
          label: i18n.t('menu:file.submenu.print'),
          accelerator: 'CmdOrCtrl+P',
          click: () => {
            console.log('Will be implemented soon');
          },
        },
        { type: 'separator' },
        {
          label: i18n.t('menu:file.submenu.updates'),
          accelerator: 'CmdOrCtrl+U',
          click: () => {
            console.log('Will be implemented soon');
          },
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
        { label: i18n.t('menu:edit.submenu.undo'), role: 'undo' },
        { label: i18n.t('menu:edit.submenu.redo'), role: 'redo' },
        { type: 'separator' },
        { label: i18n.t('menu:edit.submenu.cut'), role: 'cut' },
        { label: i18n.t('menu:edit.submenu.copy'), role: 'copy' },
        { label: i18n.t('menu:edit.submenu.paste'), role: 'paste' },
        { type: 'separator' },
        {
          label: i18n.t('menu:edit.submenu.find'),
          accelerator: 'CmdOrCtrl+F',
          click: () => {
            console.log('Will be implemented soon');
          },
        },
        {
          label: i18n.t('menu:edit.submenu.findNext'),
          accelerator: 'CmdOrCtrl+K',
          click: () => {
            console.log('Will be implemented soon');
          },
        },
        {
          label: i18n.t('menu:edit.submenu.findPrevious'),
          accelerator: 'CmdOrCtrl+Shift+K',
          click: () => {
            console.log('Will be implemented soon');
          },
        },
        { type: 'separator' },
        {
          label: i18n.t('menu:edit.submenu.findInProject'),
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => {
            console.log('Will be implemented soon');
          },
        },
        { type: 'separator' },
        { label: i18n.t('menu:edit.submenu.addElement'), submenu: [] },
        { label: i18n.t('menu:edit.submenu.selectAll'), role: 'selectAll' },
        { label: i18n.t('menu:edit.submenu.delete'), role: 'delete' },
      ],
    },
    {
      label: i18n.t('menu:display.label'),
      submenu: [
        { label: i18n.t('menu:display.submenu.refresh'), role: 'reload' },
        {
          label: i18n.t('menu:display.submenu.clearErrors'),
          accelerator: 'CmdOrCtrl+K',
          click: () => {
            console.log('Will be implemented soon');
          },
        },
        { type: 'separator' },
        { label: i18n.t('menu:display.submenu.zoom'), submenu: [] },
        { type: 'separator' },
        {
          label: i18n.t('menu:display.submenu.switchPerspective'),
          accelerator: 'F12',
          click: () => {
            console.log('Will be implemented soon');
          },
        },
        { label: i18n.t('menu:display.submenu.fullScreen'), role: 'togglefullscreen' },
        {
          label: i18n.t('menu:display.submenu.resetPerspective'),
          click: () => {
            console.log('Will be implemented soon');
          },
        },
        {
          label: i18n.t('menu:display.submenu.sortAlpha'),
          click: () => {
            console.log('Will be implemented soon');
          },
        },
        { type: 'separator' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: i18n.t('menu:help.label'),
      role: 'help',
      submenu: [
        {
          label: i18n.t('menu:help.submenu.communitySupport'),
          click: () => {
            shell.openExternal('https://openplc.discussion.community/');
          },
        },
        {
          label: i18n.t('menu:help.submenu.about'),
          role: 'about',
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
};
