/**
 * Give a project a home.
 *
 * This exists because of the state a retrieved project starts in: it lives in a
 * scratch directory, so a user-initiated Save is refused and told to use Save
 * As instead. Without this, that message points nowhere and the project can
 * never be saved at all -- the refusal would be a dead end rather than a
 * redirection.
 *
 * It is not retrieval-specific. Any project can be written somewhere else, and
 * the retrieved case is simply the one where it is not optional.
 */

import type { PlatformCapabilities } from '../../middleware/shared/ports/platform-capabilities'
import type { ProjectPort } from '../../middleware/shared/ports/project-port'
import { openPLCStoreBase } from '../store'
import { toast } from '../utils/toast'
import { buildAllProjectFileContents } from './save-actions'

export interface SaveProjectAsResult {
  success: boolean
  /** Where it went. Absent when the user cancelled or the write failed. */
  projectPath?: string
  /** True when the user closed the picker without choosing. Not a failure. */
  cancelled?: boolean
}

/**
 * Ask for a destination, write the project there, and adopt it as the
 * project's location.
 *
 * The order matters: the destination is only adopted once the write has
 * actually succeeded. Setting the path first and writing second would leave a
 * project pointing at a directory that does not contain it if the write failed
 * -- and, for a retrieved project, would clear the very flag that is protecting
 * it from a save that goes nowhere.
 */
export async function executeSaveProjectAs(
  projectPort: ProjectPort,
  _capabilities: PlatformCapabilities,
): Promise<SaveProjectAsResult> {
  if (!projectPort.pickPath) {
    toast({
      title: 'Save As is not available here',
      description: 'This platform cannot choose a folder to save into.',
      variant: 'fail',
    })
    return { success: false }
  }

  const picked = await projectPort.pickPath()
  if (!picked.success || !picked.path) {
    // Cancelling is an ordinary outcome and says nothing to the user.
    if (picked.error) {
      toast({ title: picked.error.title, description: picked.error.description, variant: 'fail' })
      return { success: false }
    }
    return { success: false, cancelled: true }
  }

  const state = openPLCStoreBase.getState()
  const contents = buildAllProjectFileContents()

  const files = {
    projectPath: picked.path,
    projectJson: contents['project.json'] ?? '',
    deviceConfig: contents['devices/configuration.json'],
    pinMapping: contents['devices/pin-mapping.json'],
    libraryManifest: contents['library.json'],
    pouFiles: toEntries(contents, 'pous/'),
    serverFiles: toEntries(contents, 'devices/servers/'),
    remoteDeviceFiles: toEntries(contents, 'devices/remote/'),
    dataTypeFiles: toEntries(contents, 'datatypes/'),
    // Nothing to delete: this is a fresh destination, and carrying deletions
    // from the old location would remove files there that were never copied.
    deletions: [],
  }

  const written = await projectPort.saveProject(files)
  if (!written.success) {
    toast({
      title: 'Could not save the project there',
      description: written.error ?? 'The files could not be written to that folder.',
      variant: 'fail',
    })
    return { success: false }
  }

  // Adopt the new location only now. A project that has one is no longer
  // ephemeral, so an ordinary Save works from here on.
  state.projectActions.updateMetaPath(picked.path)
  state.workspaceActions.setIsEphemeralProject(false)

  toast({
    title: 'Project saved',
    description: `Saved to ${picked.path}.`,
    variant: 'default',
  })
  return { success: true, projectPath: picked.path }
}

/** The entries under one directory prefix, as the write shape expects. */
function toEntries(contents: Record<string, string>, prefix: string) {
  return Object.entries(contents)
    .filter(([path]) => path.startsWith(prefix))
    .map(([relativePath, content]) => ({ relativePath, content }))
}
