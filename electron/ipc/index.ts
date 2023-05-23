import { createChildWindowIpc } from './createChildWindow';
import { createPOUWindowIpc as createPOUWindow } from './createPOUWindow';
import { themeIpc } from './theme';
import { toastIpc as toast } from './toast';
import { toolbarIpc } from './toolbar';

export const ipc = {
  setupListeners() {
    themeIpc();
    toolbarIpc();
    createChildWindowIpc();
  },
  toast,
  createPOUWindow,
};
