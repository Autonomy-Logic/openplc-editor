import './splash-screen/index'

import { contextBridge } from 'electron'

import rendererProcessBridge from '../ipc/renderer'

contextBridge.exposeInMainWorld('bridge', rendererProcessBridge)

export type ElectronHandler = typeof rendererProcessBridge

declare global {
  interface Window {
    bridge: ElectronHandler
  }
}
