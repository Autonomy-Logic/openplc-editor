export interface IBridge {
  bridge: any
}
declare global {
  interface Window {
    bridge: IBridge
  }
}
