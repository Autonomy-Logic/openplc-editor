import { i18n } from '@shared/i18n';
import { Menu, MenuItemConstructorOptions } from 'electron';

import { createProjectController } from '../controllers';
import { ipc } from '../ipc';

export const createMenu = () => {
  const { toast, pou, project } = ipc;
  const click = () => console.log('Will be implemented soon');

  const handleCreateProject = async () => {
    const { ok, reason, data } = await createProjectController.handle();
    if (!ok && reason) {
      toast.send({
        type: 'error',
        ...reason,
      });
    } else if (ok && data) {
      pou.createWindow();
      await project.send(data);
    }
  };

  const template: MenuItemConstructorOptions[] = [
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
              label: i18n.t('menu:file.submenu.examples.submenu.randomGeneratorPragma'),
              click,
            },
            {
              label: i18n.t('menu:file.submenu.examples.submenu.tcpSocket'),
              click,
            },
            {
              label: i18n.t('menu:file.submenu.examples.submenu.trafficLightFBD'),
              click,
            },
          ],
        },
        { type: 'separator' },
        {
          id: 'test',
          label: i18n.t('menu:file.submenu.save'),
          accelerator: 'CmdOrCtrl+S',
          click,
        },
        {
          label: i18n.t('menu:file.submenu.saveAs'),
          accelerator: 'CmdOrCtrl+Shift+S',
          click,
        },
        {
          label: i18n.t('menu:file.submenu.closeTab'),
          accelerator: 'CmdOrCtrl+W',
          click,
        },
        {
          label: i18n.t('menu:file.submenu.closeProject'),
          accelerator: 'CmdOrCtrl+Shift+W',
          click,
        },
        { type: 'separator' },
        {
          label: i18n.t('menu:file.submenu.pageSetup'),
          accelerator: 'CmdOrCtrl+Alt+P',
          click,
        },
        {
          label: i18n.t('menu:file.submenu.preview'),
          accelerator: 'CmdOrCtrl+Shift+P',
          click,
        },
        {
          label: i18n.t('menu:file.submenu.print'),
          accelerator: 'CmdOrCtrl+P',
          click,
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
          click,
        },
        {
          label: i18n.t('menu:edit.submenu.findNext'),
          accelerator: 'CmdOrCtrl+K',
          click,
        },
        {
          label: i18n.t('menu:edit.submenu.findPrevious'),
          accelerator: 'CmdOrCtrl+Shift+K',
          click,
        },
        { type: 'separator' },
        {
          label: i18n.t('menu:edit.submenu.findInProject'),
          accelerator: 'CmdOrCtrl+Shift+F',
          click,
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
          click,
        },
        { type: 'separator' },
        { label: i18n.t('menu:display.submenu.zoom'), submenu: [] },
        { type: 'separator' },
        {
          label: i18n.t('menu:display.submenu.switchPerspective'),
          accelerator: 'F12',
          click,
        },
        { label: i18n.t('menu:display.submenu.fullScreen'), role: 'togglefullscreen' },
        {
          label: i18n.t('menu:display.submenu.resetPerspective'),
          click,
        },
        {
          label: i18n.t('menu:display.submenu.sortAlpha'),
          click,
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
          click,
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
