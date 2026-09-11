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
import { createEditorAIAdapter } from './adapters/editor/ai-adapter'
import { createEditorCompilerAdapter } from './adapters/editor/compiler-adapter'
import { createEditorDebuggerAdapter } from './adapters/editor/debugger-adapter'
import { createEditorDeviceAdapter } from './adapters/editor/device-adapter'
import { editorEdgeAccountPort } from './adapters/editor/edge-account-adapter'
import { createEditorEsiAdapter } from './adapters/editor/esi-adapter'
import { createEditorLibraryAdapter } from './adapters/editor/library-adapter'
import { createEditorNavigationAdapter } from './adapters/editor/navigation-adapter'
import { openFetchedProject } from './adapters/editor/open-fetched-project'
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
 * Opening a fetched project is the one retrieve step that needs two ports, so
 * it is composed here where both are in scope. The work itself lives in its own
 * module, where a test can reach it — see `open-fetched-project.ts`.
 */
editorRuntime.openFetchedProject = (project) => openFetchedProject(project, editorProject)

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
  /**
   * The assistant. Wired unconditionally, exactly like the account port above: whether
   * anything appears is decided by `capabilities.hasAIAssistant`, by the consent the
   * user gave and by whether they are signed in to Edge — not by the port's absence.
   */
  ai: createEditorAIAdapter({
    // No build-time kill switch on the desktop. The main process holds the only route to
    // the AI endpoints, so a build whose proxy is absent already fails closed; adding a
    // second, silent way to be off would just make "why is the button missing" harder to
    // answer.
    isFeatureEnabled: true,
    hasUserConsented: hasAiConsent(),
    inlineCompletionsEnabled: readInlineCompletionsPreference(),
  }),
  capabilities: { ...EDITOR_CAPABILITIES, isDevMode: process.env.NODE_ENV === 'development' },
}

/**
 * Whether the user has accepted the AI notice.
 *
 * Read from the same `localStorage` key the shared consent modal writes
 * (`monaco/ai-consent-modal.tsx`), because the modal is shared surface and the desktop
 * renderer has a perfectly ordinary `localStorage`. Anything unreadable reads as "not
 * accepted": consent that cannot be demonstrated is consent that was not given.
 */
function hasAiConsent(): boolean {
  try {
    return localStorage.getItem('ai-consent-v1') === 'accepted'
  } catch {
    return false
  }
}

/**
 * The user's ghost-text preference, written by the shared AI settings popover.
 *
 * Defaults to on — matching the store's own default — so a first run, a cleared profile
 * or an unreadable value all land on the same behaviour rather than silently disabling a
 * feature the user never turned off.
 */
function readInlineCompletionsPreference(): boolean {
  try {
    const raw = localStorage.getItem('ai-preferences-v1')

    if (!raw) {
      return true
    }

    const parsed: unknown = JSON.parse(raw)

    if (typeof parsed !== 'object' || parsed === null || !('inlineCompletionsEnabled' in parsed)) {
      return true
    }

    return parsed.inlineCompletionsEnabled !== false
  } catch {
    return true
  }
}
