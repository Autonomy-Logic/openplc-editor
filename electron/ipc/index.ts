import { childWindowIpc } from './childWindow';
import { pouIpc as pou } from './pou';
import { project, projectIpc } from './project';
import { themeIpc } from './theme';
import { toastIpc as toast } from './toast';

export const ipc = {
  setupListeners() {
    themeIpc();
    childWindowIpc();
    projectIpc();
  },
  toast,
  pou,
  project,
};
