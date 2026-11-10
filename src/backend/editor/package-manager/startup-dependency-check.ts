/**
 * The editor's startup check: installs the simulator's core and the global
 * libraries when they are missing, in the background. Builds and board package
 * installs wait for it through `StartupDependencyGate`. Nothing is updated, and
 * nothing touches the network when everything is already installed.
 */

import {
  planDependencyInstall,
  STARTUP_ARDUINO_DEPENDENCIES,
  startupInstallNotice,
  startupInstallWarning,
} from '@root/backend/shared/packages/arduino-dependencies'
import type { StartupNotice } from '@root/middleware/shared/ports/types'

import {
  type ArduinoCliSpawner,
  installArduinoDependencies,
  queryInstalledArduinoState,
} from './arduino-dependency-installer'
import type { StartupDependencyGate } from './vpp-dependency-service'

export class StartupDependencyCheck implements StartupDependencyGate {
  #running = false
  #done: Promise<void> = Promise.resolve()
  #notices: StartupNotice[] = []
  #onNotice: (() => void) | null = null

  constructor(private readonly spawnCli: ArduinoCliSpawner) {}

  isRunning(): boolean {
    return this.#running
  }

  whenDone(): Promise<void> {
    return this.#done
  }

  /** Starts the check once @p ready settles, which is when the arduino-cli configuration exists. */
  start(ready: Promise<unknown>): void {
    this.#running = true
    this.#done = ready
      .catch(() => undefined)
      .then(() => this.#run())
      .catch((err: unknown) => this.#notify('warning', startupInstallWarning(errorText(err))))
      .finally(() => {
        this.#running = false
      })
  }

  /** Returns and forgets the notices not yet shown. */
  takeNotices(): StartupNotice[] {
    const notices = this.#notices
    this.#notices = []
    return notices
  }

  /** Called whenever a new notice is queued. */
  setNoticeListener(listener: (() => void) | null): void {
    this.#onNotice = listener
  }

  async #run(): Promise<void> {
    const installed = await queryInstalledArduinoState(this.spawnCli)
    const steps = planDependencyInstall(STARTUP_ARDUINO_DEPENDENCIES, installed)
    if (steps.length === 0) return
    this.#notify('info', startupInstallNotice(steps))
    const result = await installArduinoDependencies(STARTUP_ARDUINO_DEPENDENCIES, this.spawnCli, () => undefined, {
      keepGoing: true,
    })
    if (result.ok) this.#notify('info', 'Arduino components installed.')
    else this.#notify('warning', startupInstallWarning(result.error))
  }

  #notify(level: StartupNotice['level'], message: string): void {
    this.#notices.push({ level, message })
    this.#onNotice?.()
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
