import { contextBridge } from 'electron';
import rendererProcessBridge from '../ipc/renderer';

import './scripts/loading/index';
import './scripts/titlebar/index';

contextBridge.exposeInMainWorld('bridge', rendererProcessBridge);

export type ElectronHandler = typeof rendererProcessBridge;
