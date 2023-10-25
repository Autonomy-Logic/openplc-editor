import { contextBridge } from 'electron';
import rendererProcessBridge from './modules/ipc/renderer';

import './loading/index';
// import './titlebar';

contextBridge.exposeInMainWorld('bridge', rendererProcessBridge);

export type ElectronHandler = typeof rendererProcessBridge;
