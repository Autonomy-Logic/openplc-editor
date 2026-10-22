/**
 * ConfiguratorPort — Drives a vendor configurator embedded in a sandboxed iframe.
 *
 * The host only talks to the guest through postMessage; it never reads the
 * iframe's globals. One instance per mounted iframe; `dispose` on unmount.
 */

import type { DeviceSetup } from '../vendor-document/protocol'
import type { Unsubscribe } from './types'

export interface ConfiguratorSnapshot {
  /** Opaque vendor archive, stored and returned byte-for-byte. */
  archive: string
  deviceSetup: DeviceSetup
}

export interface ConfiguratorPort {
  /** Resolves once the relay announced a matching protocol version; rejects on mismatch or timeout. */
  ready(): Promise<void>
  setController(deviceTypeId: string): Promise<void>
  show(): Promise<void>
  /** Applies a stored archive. Rejects an empty archive without calling the guest. */
  load(archive: string): Promise<void>
  getDeviceSetup(): Promise<DeviceSetup>
  snapshot(): Promise<ConfiguratorSnapshot>
  onModified(callback: () => void): Unsubscribe
  onError(callback: (message: string) => void): Unsubscribe
  /** Stops listening and rejects every pending call. */
  dispose(): void
}
