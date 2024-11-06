import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI // Remove this
    api: unknown // We will be using this
  }
}
