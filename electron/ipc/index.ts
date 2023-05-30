import { createChildWindowIpc } from './createChildWindow';
import { createPOUWindowIpc as createPOUWindow } from './createPOUWindow';
import { createProjectFromToolbarIpc } from './createProjectFromToolbar';
import { themeIpc } from './theme';
import { toastIpc as toast } from './toast';
import { toolbarIpc } from './toolbar';

export const ipc = {
  setupListeners() {
    themeIpc();
    toolbarIpc();
    createChildWindowIpc();
    createProjectFromToolbarIpc();
  },
  toast,
  createPOUWindow,
};
