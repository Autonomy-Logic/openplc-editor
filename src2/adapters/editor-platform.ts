/**
 * Editor platform adapter — wires all port interfaces to Electron IPC bridge.
 *
 * This file creates the concrete PlatformPorts object for the Electron editor.
 * Each port delegates to `window.bridge.*` methods exposed by the preload script.
 *
 * During migration, ports will be implemented one at a time. Unimplemented ports
 * throw "not yet migrated" errors to make it clear what still needs work.
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
import { createEditorSystemAdapter } from './editor/system-adapter'
import { createEditorThemeAdapter } from './editor/theme-adapter'
import { createEditorWindowAdapter } from './editor/window-adapter'

function notMigrated(portName: string): never {
  throw new Error(`[EditorAdapter] ${portName} is not yet migrated. Implement the adapter to use this port.`)
}

function createStubPort<T extends object>(portName: string): T {
  return new Proxy({} as T, {
    get(_, prop) {
      if (typeof prop === 'string') {
        return () => notMigrated(`${portName}.${prop}`)
      }
      return undefined
    },
  })
}

/**
 * Editor platform ports — Electron IPC bridge implementations.
 *
 * Ports are stubbed with proxy objects that throw descriptive errors
 * when called. Replace each stub with a real implementation as you
 * migrate that vertical slice.
 *
 * Example — migrating CompilerPort:
 *
 *   import { createEditorCompilerAdapter } from './compiler-adapter'
 *   // Then replace the stub below:
 *   compiler: createEditorCompilerAdapter(),
 */
export const editorPorts: PlatformPorts = {
  compiler: createStubPort('CompilerPort'),
  runtime: createStubPort('RuntimePort'),
  debugger: createStubPort('DebuggerPort'),
  simulator: createStubPort('SimulatorPort'),
  project: createStubPort('ProjectPort'),
  device: createStubPort('DevicePort'),
  system: createEditorSystemAdapter(),
  window: createEditorWindowAdapter(),
  accelerator: createStubPort('AcceleratorPort'),
  theme: createEditorThemeAdapter(),
  capabilities: EDITOR_CAPABILITIES,
}
