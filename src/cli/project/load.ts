/**
 * Loading a project the way the editor loads it.
 *
 * The compile-ready snapshot depends on more than `project.json`: alias →
 * address resolution is derived from the DEVICE state too (the selected board,
 * its pin mapping, VPP screen data, remote devices), which `buildIecRegistry`
 * reads straight off the store. Reconstructing those inputs by hand here would
 * be a second implementation of address allocation — the exact divergence this
 * CLI exists to avoid.
 *
 * So the CLI reuses the main process's `readProjectFiles`, hands the result to
 * the same `parseProjectFiles` the project adapter calls, and drives a real
 * store instance through `sharedWorkspaceActions.handleOpenProjectResponse` —
 * the single entry point the renderer uses on project open. Zustand is plain
 * JavaScript, so this needs no renderer and no window; the store is simply an
 * in-process project model. The payoff is that `getCompileReadyProjectData()`
 * here is literally the same call the GUI's build button makes.
 */

import { ProjectService } from '@root/backend/editor/services'
import { parseProjectFiles } from '@root/backend/shared/utils/parse-project-files'
import { createOpenPLCStore } from '@root/frontend/store'
import { isDataTypeFilesEnabled } from '@root/frontend/utils/feature-flags'
import type { PLCProjectData } from '@root/middleware/shared/ports/types'

export interface LoadedProject {
  projectPath: string
  name: string
  /** Aliases still in their stored form — what the GUI displays. */
  data: PLCProjectData
  /** Aliases resolved to concrete IEC addresses — what the compiler consumes. */
  compileReady: PLCProjectData
  /** Board the project last selected; the default compile target. */
  board: string
  vendorScreenData: Record<string, unknown> | undefined
  communicationPort: string | undefined
  warnings: string[]
}

export type LoadProjectResult = { success: true; project: LoadedProject } | { success: false; error: string }

export async function loadProject(projectPath: string): Promise<LoadProjectResult> {
  // The main process's own reader, so the CLI sees exactly the file set the
  // GUI sees — including the defaults it synthesises for missing device files.
  const raw = await new ProjectService().readRawProjectFiles(projectPath)
  if (!raw.success || !raw.data) {
    return {
      success: false,
      error: raw.error?.description ?? `Could not read a project at ${projectPath}`,
    }
  }

  const parsed = parseProjectFiles(
    raw.data.projectPath,
    raw.data.projectJson,
    raw.data.deviceConfig,
    raw.data.pinMapping,
    raw.data.pouFiles,
    raw.data.serverFiles,
    raw.data.remoteDeviceFiles,
    raw.data.libraryManifest,
    // Same flag gate the project adapter applies: with the flag off, legacy
    // project.json stays the source of truth for datatypes.
    isDataTypeFilesEnabled() && Array.isArray(raw.data.dataTypeFiles) ? raw.data.dataTypeFiles : [],
  )

  // A store instance per load, not the shared singleton: two loads in one
  // process must not see each other's project.
  const store = createOpenPLCStore()
  store.getState().sharedWorkspaceActions.handleOpenProjectResponse(parsed)

  const state = store.getState()
  return {
    success: true,
    project: {
      projectPath,
      name: state.project.meta.name,
      data: state.project.data,
      compileReady: state.projectActions.getCompileReadyProjectData(),
      board: state.deviceDefinitions.configuration.deviceBoard,
      vendorScreenData: state.deviceDefinitions.configuration.vendorScreenData,
      communicationPort: state.deviceDefinitions.configuration.communicationPort,
      warnings: parsed.warnings ?? [],
    },
  }
}
