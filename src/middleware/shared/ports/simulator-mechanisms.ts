/**
 * What a platform provides to run the WebAssembly simulator off the main thread: a way to start a thread that runs
 * `serveSimulatorThread`, and the thread's side of the message channel. Everything else is shared.
 */

/** The main side of one simulator thread. */
export interface SimulatorThreadHandle {
  post(message: unknown): void
  onMessage(listener: (message: unknown) => void): void
  /** Called once when the thread ends without being asked to, with the reason. */
  onFailure(listener: (reason: string) => void): void
  terminate(): void | Promise<void>
}

export interface SimulatorThreadMechanism {
  /** Starts a thread; a platform may load the thread's code first, so this may resolve later. */
  spawn(): SimulatorThreadHandle | Promise<SimulatorThreadHandle>
}

/** The thread's side of the channel. */
export interface SimulatorThreadChannel {
  post(message: unknown): void
  onMessage(listener: (message: unknown) => void): void
}
