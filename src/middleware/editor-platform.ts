/**
 * Editor platform adapter — wires all port interfaces to Electron IPC bridge.
 *
 * This file creates the concrete PlatformPorts object for the Electron editor.
 * Each port delegates to `window.bridge.*` methods exposed by the preload script.
 *
 * Usage:
 *   import { editorPorts } from './adapters/editor-platform'
 *
 *   // In App.tsx root:
 *   <PlatformProvider ports={editorPorts}>
 *     <App />
 *   </PlatformProvider>
 */

import { createEditorAcceleratorAdapter } from './adapters/editor/accelerator-adapter'
import { createEditorCompilerAdapter } from './adapters/editor/compiler-adapter'
import { createEditorDebuggerAdapter } from './adapters/editor/debugger-adapter'
import { createEditorDeviceAdapter } from './adapters/editor/device-adapter'
import { editorEdgeAccountPort } from './adapters/editor/edge-account-adapter'
import { createEditorEsiAdapter } from './adapters/editor/esi-adapter'
import { createEditorLibraryAdapter } from './adapters/editor/library-adapter'
import { createEditorNavigationAdapter } from './adapters/editor/navigation-adapter'
import { createEditorOrchestratorAdapter } from './adapters/editor/orchestrator-adapter'
import { createEditorPackageAdapter } from './adapters/editor/package-adapter'
import { createEditorProjectAdapter } from './adapters/editor/project-adapter'
import { createEditorRuntimeAdapter } from './adapters/editor/runtime-adapter'
import { createEditorSimulatorAdapter } from './adapters/editor/simulator-adapter'
import { createEditorStlibSourceAdapter } from './adapters/editor/stlib-source-adapter'
import { createEditorSystemAdapter } from './adapters/editor/system-adapter'
import { createEditorThemeAdapter } from './adapters/editor/theme-adapter'
import { createEditorVersionControlAdapter } from './adapters/editor/version-control-adapter'
import { createEditorWindowAdapter } from './adapters/editor/window-adapter'
import { EDITOR_CAPABILITIES } from './shared/ports/platform-capabilities'
import type { PlatformPorts } from './shared/providers/types'

/**
 * Runtime connection target — IP address of the OpenPLC runtime device.
 * Set by the store/UI when the user configures or connects to a device.
 */
let _runtimeIpAddress = ''
let _projectPath = ''

export function setRuntimeIpAddress(ip: string): void {
  _runtimeIpAddress = ip
}

export function setProjectPath(path: string): void {
  _projectPath = path
}

/**
 * Editor platform ports — all port interfaces wired to Electron IPC bridge.
 */
const editorProject = createEditorProjectAdapter()
const editorRuntime = createEditorRuntimeAdapter(() => _runtimeIpAddress)

/**
 * Opening a fetched project is the one retrieve step that needs two ports.
 *
 * The runtime adapter unpacks the archive into a scratch directory; turning
 * that directory into the open project is the project port's job. Wired here
 * rather than inside either adapter, which is where both are already in scope.
 */
editorRuntime.openFetchedProject = async (project) => {
  const opened = await editorProject.openProjectByPath(String(project.payload))
  return opened.success
    ? { success: true }
    : { success: false, error: opened.error?.description ?? 'The retrieved project could not be opened.' }
}

export const editorPorts: PlatformPorts = {
  compiler: createEditorCompilerAdapter(),
  runtime: editorRuntime,
  debugger: createEditorDebuggerAdapter(),
  simulator: createEditorSimulatorAdapter(),
  project: editorProject,
  device: createEditorDeviceAdapter(),
  orchestrator: createEditorOrchestratorAdapter(),
  system: createEditorSystemAdapter(),
  window: createEditorWindowAdapter(),
  accelerator: createEditorAcceleratorAdapter(),
  theme: createEditorThemeAdapter(),
  packages: createEditorPackageAdapter(),
  esi: createEditorEsiAdapter(() => _projectPath),
  versionControl: createEditorVersionControlAdapter(),
  navigation: createEditorNavigationAdapter(),
  library: createEditorLibraryAdapter(),
  stlibSource: createEditorStlibSourceAdapter(),
  /**
   * The Edge account. `EDITOR_CAPABILITIES` pairs it with `requiresEdgeAccount: false`,
   * so the account control appears in the same slot as it does on the web while
   * signing in stays optional here.
   */
  edgeAccount: editorEdgeAccountPort,
  capabilities: { ...EDITOR_CAPABILITIES, isDevMode: process.env.NODE_ENV === 'development' },
}
