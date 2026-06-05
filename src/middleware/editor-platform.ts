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
export const editorPorts: PlatformPorts = {
  compiler: createEditorCompilerAdapter(),
  runtime: createEditorRuntimeAdapter(() => _runtimeIpAddress),
  debugger: createEditorDebuggerAdapter(),
  simulator: createEditorSimulatorAdapter(),
  project: createEditorProjectAdapter(),
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
  capabilities: { ...EDITOR_CAPABILITIES, isDevMode: process.env.NODE_ENV === 'development' },
}
