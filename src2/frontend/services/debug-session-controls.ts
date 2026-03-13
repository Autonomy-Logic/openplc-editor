export type DebugSessionControls = {
  startDebug:
    | ((
        deviceId: string,
        username: string,
        password: string,
        debugCContent: string,
        port?: number,
      ) => Promise<boolean> | boolean)
    | null
  stopDebug: (() => void) | null
  forceVariable: ((index: number, force: boolean, valueHex?: string) => Promise<boolean>) | null
}

const controls: DebugSessionControls = {
  startDebug: null,
  stopDebug: null,
  forceVariable: null,
}

export function setDebugSessionControls(c: Partial<DebugSessionControls>): void {
  Object.assign(controls, c)
}

export function getDebugSessionControls(): Readonly<DebugSessionControls> {
  return controls
}

export function clearDebugSessionControls(): void {
  controls.startDebug = null
  controls.stopDebug = null
  controls.forceVariable = null
}
