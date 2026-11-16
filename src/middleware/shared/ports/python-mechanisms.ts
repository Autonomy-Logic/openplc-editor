/** The main side of the Python thread. */
export interface PythonThreadHandle {
  post(message: unknown): void
  onMessage(listener: (message: unknown) => void): void
  /** Called once when the thread ends without being asked to, with the reason. */
  onFailure(listener: (reason: string) => void): void
  /** Ends the thread and everything running in it. */
  terminate(): void
}

export interface PythonThreadMechanism {
  /** Starts the thread; a platform may load the thread's code first, so this may resolve later. */
  spawn(): PythonThreadHandle | Promise<PythonThreadHandle>
  /** Whether the page is cross-origin isolated, as the browser reports it. Platforms that are not a page omit it. */
  isCrossOriginIsolated?(): boolean
}

/** The thread's side of the channel. */
export interface PythonThreadChannel {
  post(message: unknown): void
  onMessage(listener: (message: unknown) => void): void
}

/** The bundled Python runtime's files, as the thread receives them. */
export interface PythonRuntimeAssets {
  /** The CPython package (WEBC). */
  pythonPackage: Uint8Array
  /** The numpy wheel. */
  numpyWheel: Uint8Array
}
