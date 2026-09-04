/**
 * Making a retrieved project the open one, on the desktop.
 *
 * The retrieve flow needs two ports: the runtime adapter unpacks the archive
 * into a scratch directory, and turning that directory into the open project is
 * the project port's job. This is the seam between them, kept in its own module
 * so it can be tested — the composition lived inline in `editor-platform.ts`,
 * which imports every adapter at module load and is not reachable from a test.
 *
 * Two steps, and missing the second is what made a successful retrieve land on
 * the start screen: `openProjectByPath` only READS and parses, handing back a
 * parsed project and touching no state. `handleOpenProjectResponse` is what
 * loads it, exactly as the recent-projects list and the open-project
 * accelerator do it. Web's `importRetrievedProject` ends the same way.
 */

import { openPLCStoreBase } from '../../../frontend/store'
import type { ProjectPort } from '../../shared/ports/project-port'
import type { FetchedProject } from '../../shared/ports/runtime-port'

export async function openFetchedProject(
  project: FetchedProject,
  projectPort: ProjectPort,
): Promise<{ success: boolean; error?: string }> {
  const opened = await projectPort.openProjectByPath(String(project.payload))
  // `data` is checked as well as `success`: a response that claims success with
  // nothing to open would otherwise be reported as an open project that is not
  // there, which is the failure this module exists to prevent.
  if (!opened.success || !opened.data) {
    return { success: false, error: opened.error?.description ?? 'The retrieved project could not be opened.' }
  }
  openPLCStoreBase.getState().sharedWorkspaceActions.handleOpenProjectResponse(opened.data)
  return { success: true }
}
