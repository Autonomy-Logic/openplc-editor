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

import { HardwareModule } from '@root/backend/editor/hardware'
import { ProjectService } from '@root/backend/editor/services'
import { parseProjectFiles } from '@root/backend/shared/utils/parse-project-files'
import { openPLCStoreBase } from '@root/frontend/store'
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
    // Array guard, same as the project adapter: the IPC payload is a cast,
    // not validated, so a version-skewed main process must not crash a load.
    Array.isArray(raw.data.dataTypeFiles) ? raw.data.dataTypeFiles : [],
  )

  // Boards first, exactly as the workspace screen does on load: target-capability
  // resolution and the debug-spec resolver both read `availableBoards`, and
  // `setAvailableOptions` is what re-syncs aliases for the active target. Without
  // it the store looks like an editor that has not finished starting up.
  openPLCStoreBase
    .getState()
    .deviceActions.setAvailableOptions({ availableBoards: await new HardwareModule().getAvailableBoards() })

  // The SHARED singleton, not a private instance. Everything the editor's own
  // resolvers read comes off it — `buildDeviceResolverContext` reads the device
  // configuration and runtime connection from `useOpenPLCStore.getState()`, and
  // the debug tree builder reads the project. Hydrating a private store would
  // leave those resolvers looking at an empty one, and the CLI would have to
  // reimplement them. One project per process is the same assumption the editor
  // makes, and a CLI invocation is one project.
  openPLCStoreBase.getState().sharedWorkspaceActions.handleOpenProjectResponse(parsed)

  const state = openPLCStoreBase.getState()
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

/**
 * Apply the connection details a command was given, as the device screen does.
 *
 * `--port` is the serial-port dropdown and `--host` the runtime address field.
 * They have to land in the STORE rather than being passed along the side,
 * because the debug-spec resolver reads `configuration.communicationPort` /
 * `configuration.runtimeIpAddress` from there — that is how a board's declared
 * serial channel learns which port it is on. A command that only threaded them
 * into the compile arguments would build fine and then fail to resolve a debug
 * channel, for no visible reason.
 */
export function applyConnectionOverrides(overrides: { port?: string; host?: string }): void {
  const configuration: { communicationPort?: string; runtimeIpAddress?: string } = {}
  if (overrides.port) configuration.communicationPort = overrides.port
  if (overrides.host) configuration.runtimeIpAddress = overrides.host
  if (Object.keys(configuration).length === 0) return
  openPLCStoreBase.getState().deviceActions.setDeviceDefinitions({ configuration })
}
