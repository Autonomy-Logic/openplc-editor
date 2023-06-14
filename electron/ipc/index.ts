import { childWindowIpc } from './childWindow';
import { pou } from './pou';
import { project, projectIpc } from './project';
import { themeIpc } from './theme';
import { toast } from './toast';

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
