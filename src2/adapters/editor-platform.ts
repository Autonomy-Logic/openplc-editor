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

import type { PlatformPorts } from '../providers/platform/types'
import { EDITOR_CAPABILITIES } from '../providers/platform/ports/platform-capabilities'
import { createEditorAcceleratorAdapter } from './editor/accelerator-adapter'
import { createEditorCompilerAdapter } from './editor/compiler-adapter'
import type { EditorDebugConnectionConfig } from './editor/debugger-adapter'
import { createEditorDebuggerAdapter } from './editor/debugger-adapter'
import { createEditorDeviceAdapter } from './editor/device-adapter'
import { createEditorProjectAdapter } from './editor/project-adapter'
import { createEditorRuntimeAdapter } from './editor/runtime-adapter'
import { createEditorSystemAdapter } from './editor/system-adapter'
import { createEditorThemeAdapter } from './editor/theme-adapter'
import { createEditorSimulatorAdapter } from './editor/simulator-adapter'
import { createEditorWindowAdapter } from './editor/window-adapter'

/**
 * Runtime connection target — IP address of the OpenPLC runtime device.
 * Set by the store/UI when the user configures or connects to a device.
 */
let _runtimeIpAddress = ''
let _debugConnectionConfig: EditorDebugConnectionConfig | null = null

export function setRuntimeIpAddress(ip: string): void {
  _runtimeIpAddress = ip
}

export function setDebugConnectionConfig(config: EditorDebugConnectionConfig | null): void {
  _debugConnectionConfig = config
}

/**
 * Editor platform ports — all port interfaces wired to Electron IPC bridge.
 */
export const editorPorts: PlatformPorts = {
  compiler: createEditorCompilerAdapter(),
  runtime: createEditorRuntimeAdapter(() => _runtimeIpAddress),
  debugger: createEditorDebuggerAdapter(() => _debugConnectionConfig),
  simulator: createEditorSimulatorAdapter(),
  project: createEditorProjectAdapter(),
  device: createEditorDeviceAdapter(),
  system: createEditorSystemAdapter(),
  window: createEditorWindowAdapter(),
  accelerator: createEditorAcceleratorAdapter(),
  theme: createEditorThemeAdapter(),
  capabilities: EDITOR_CAPABILITIES,
}
