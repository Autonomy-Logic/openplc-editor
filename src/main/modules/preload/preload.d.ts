import { ElectronHandler } from './index';

declare global {
  // eslint-disable-next-line no-unused-vars
  interface Window {
    bridge: ElectronHandler;
  }
}

export {};
