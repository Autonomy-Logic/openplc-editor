import { ipcTheme } from './theme';
import { ipcToolBar } from './toolbar';

const setup = () => {
  ipcTheme();
  ipcToolBar();
};

const ipcs = {
  ipcTheme,
  ipcToolBar,
};

export const Ipc = {
  setup,
  ipcs,
};
