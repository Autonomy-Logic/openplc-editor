import type { ProjectPort } from '../../middleware/shared/ports/project-port'

/**
 * Re-reads the project still open after an open that failed past the read, so the
 * main process's file-access root points back at it.
 */
export function restoreOpenProjectRoot(projectPort: ProjectPort, openPath: string): void {
  if (openPath === '') return
  void projectPort.openProjectByPath(openPath).catch(() => null)
}
