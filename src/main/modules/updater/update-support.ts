import { dirname, resolve } from 'path'

import { describeUnstableLocation } from '../../../backend/editor/cli-shim/shim-plan'
import type { UpdateSupport } from './update-service'

/**
 * Can this process update itself, and where does the install live?
 *
 * Windows is off until its installers are code-signed (DOPE-486): clients up
 * to now have no `publisherName`, so an update would be installed without a
 * signature check.
 */
export function detectUpdateSupport({
  isPackaged,
  platform,
  execPath,
  appImagePath,
}: {
  isPackaged: boolean
  platform: NodeJS.Platform
  execPath: string
  appImagePath: string | undefined
}): UpdateSupport {
  if (!isPackaged) return { kind: 'development' }
  if (platform === 'win32') return { kind: 'windows' }

  if (platform === 'darwin') {
    // Same rules as the CLI shim: a mounted disk image or a translocated copy
    // is not where the app lives, and Squirrel cannot replace it there.
    if (describeUnstableLocation(execPath, 'darwin') !== undefined) return { kind: 'unstable-location' }
    // …/OpenPLC Editor.app/Contents/MacOS/OpenPLC Editor → the folder holding the .app
    const bundle = resolve(execPath, '..', '..', '..')
    return { kind: 'supported', installDir: dirname(bundle) }
  }

  // Linux: only an AppImage can replace itself; the runtime exports its path.
  if (!appImagePath) return { kind: 'not-appimage' }
  return { kind: 'supported', installDir: dirname(appImagePath) }
}
