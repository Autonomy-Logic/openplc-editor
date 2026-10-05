/**
 * AppUpdatePort — the desktop editor's notice that a newer version is out, as
 * the status bar sees it (DOPE-486).
 *
 * Editor adapter: the main-process update service over IPC. It checks once per
 *                 launch and, on request, downloads the installer for this
 *                 computer and opens it. The user runs the installer.
 * Web adapter:    none. The web app is deployed, not installed, so the port is
 *                 absent and nothing is shown.
 */

import type { Unsubscribe } from './types'

export type AppUpdateStatus =
  | { state: 'none' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'downloaded'; version: string }

export interface AppUpdatePort {
  /** What to show now. Asked once on mount; later changes arrive through `onStatusChanged`. */
  getStatus(): Promise<AppUpdateStatus>

  onStatusChanged(callback: (status: AppUpdateStatus) => void): Unsubscribe

  /** Download the installer for the new version, or reuse the one downloaded, and open it. */
  downloadAndOpen(): void
}

/** Validates a status received from outside the renderer; anything unreadable shows nothing. */
export function toAppUpdateStatus(value: unknown): AppUpdateStatus {
  if (typeof value !== 'object' || value === null || !('state' in value) || !('version' in value)) {
    return { state: 'none' }
  }
  const { state, version } = value
  if (typeof version !== 'string' || version === '') return { state: 'none' }
  if (state === 'available' || state === 'downloaded') return { state, version }
  if (state === 'downloading' && 'percent' in value && typeof value.percent === 'number') {
    return { state, version, percent: Math.max(0, Math.min(100, Math.round(value.percent))) }
  }
  return { state: 'none' }
}
