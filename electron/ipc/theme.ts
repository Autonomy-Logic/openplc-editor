import { CONSTANTS } from '@shared/constants';
import { ThemeProps, themeSchema } from '@shared/types/theme';
import { ipcMain } from 'electron';

import { store } from '../store';

const {
  channels: { get, set },
} = CONSTANTS;

export const themeIpc = () => {
  ipcMain.on(get.THEME, (event) => {
    const theme = store.get('theme') as ThemeProps;
    event.sender.send(get.THEME, theme);
  });

  ipcMain.on(set.THEME, (_event, arg: ThemeProps) => {
    const theme = themeSchema.parse(arg);
    store.set('theme', theme);
  });
};
