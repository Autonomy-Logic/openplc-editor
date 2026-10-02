/**
 * AppUpdatePort — the desktop editor's update of itself, as the status bar sees it (DOPE-486).
 *
 * Editor adapter: the main-process update service over IPC. It checks once per
 *                 launch, downloads in the background, and reports `ready` when
 *                 a restart would install the update at once.
 * Web adapter:    none. The web app is deployed, not installed, so the port is
 *                 absent and nothing is shown.
 */

import type { Unsubscribe } from './types'

export type AppUpdateStatus = { state: 'none' } | { state: 'ready'; version: string }

export interface AppUpdatePort {
  /** What to show now. Asked once on mount; later changes arrive through `onStatusChanged`. */
  getStatus(): Promise<AppUpdateStatus>

  onStatusChanged(callback: (status: AppUpdateStatus) => void): Unsubscribe

  /** Restart into the downloaded update. Unsaved work is asked about first, as for any quit. */
  installAndRestart(): void
}

/** Validates a status received from outside the renderer; anything unreadable shows nothing. */
export function toAppUpdateStatus(value: unknown): AppUpdateStatus {
  if (typeof value !== 'object' || value === null || !('state' in value)) return { state: 'none' }
  if (value.state === 'ready' && 'version' in value && typeof value.version === 'string' && value.version !== '') {
    return { state: 'ready', version: value.version }
  }
  return { state: 'none' }
}
