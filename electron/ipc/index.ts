import { createNewPouWindowIpc as createNewPouWindow } from './createNewPouWindow';
import { themeIpc } from './theme';
import { toastIpc as toast } from './toast';
import { toolbarIpc } from './toolbar';

export const ipc = {
  setupListeners() {
    themeIpc();
    toolbarIpc();
  },
  toast,
  createNewPouWindow,
};
