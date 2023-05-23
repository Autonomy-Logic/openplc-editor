import { CONSTANTS } from '@shared/constants';
import { ToolbarPositionProps, toolbarPositionSchema } from '@shared/types/toolbar';
import { ipcMain } from 'electron';

import { store } from '../store';

const {
  channels: { get, set },
} = CONSTANTS;

export const toolbarIpc = () => {
  ipcMain.on(get.TOOLBAR_POSITION, (event) => {
    const position = store.get('toolbar.position') as ToolbarPositionProps;
    event.sender.send(get.TOOLBAR_POSITION, position);
  });

  ipcMain.on(set.TOOLBAR_POSITION, (_event, arg: ToolbarPositionProps) => {
    const position = toolbarPositionSchema.parse(arg);
    store.set('toolbar.position', position);
  });
};
