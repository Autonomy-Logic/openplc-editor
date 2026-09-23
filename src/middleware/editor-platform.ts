/**
 * Editor platform adapter — wires all port interfaces to Electron IPC bridge (`window.bridge.*`).
 */

import { APP_VERSION } from '../frontend/data/constants/app-version'
import { createEditorAcceleratorAdapter } from './adapters/editor/accelerator-adapter'
import { createEditorAIAdapter } from './adapters/editor/ai-adapter'
import { createEditorCompilerAdapter } from './adapters/editor/compiler-adapter'
import { createEditorDebuggerAdapter } from './adapters/editor/debugger-adapter'
import { createEditorDeviceAdapter } from './adapters/editor/device-adapter'
import { editorEdgeAccountPort } from './adapters/editor/edge-account-adapter'
import { editorEditSessionPort } from './adapters/editor/edit-session-adapter'
import { createEditorEsiAdapter } from './adapters/editor/esi-adapter'
import { createEditorLibraryAdapter } from './adapters/editor/library-adapter'
import { createEditorNavigationAdapter } from './adapters/editor/navigation-adapter'
import { openFetchedProject } from './adapters/editor/open-fetched-project'
import { createEditorOrchestratorAdapter } from './adapters/editor/orchestrator-adapter'
import { createEditorPackageAdapter } from './adapters/editor/package-adapter'
import { createPackageUpdateNotifier } from './adapters/editor/package-update-notice'
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
 * Composed here because it needs both the project and runtime ports in scope; see `open-fetched-project.ts`.
 */
editorRuntime.openFetchedProject = (project) => openFetchedProject(project, editorProject)

const editorPackages = createEditorPackageAdapter()

/**
 * Tells a build whether the board's package has a newer, editor-compatible
 * release. Exported so the app root can `prime()` it at startup: the catalogue
 * is fetched once, off the build's critical path, and every build after that
 * reads the answer without touching the network.
 */
export const packageUpdateNotifier = createPackageUpdateNotifier(editorPackages, APP_VERSION)

export const editorPorts: PlatformPorts = {
  compiler: createEditorCompilerAdapter({
    findPackageUpdateNotice: (packageId) => packageUpdateNotifier.notice(packageId),
  }),
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
  packages: editorPackages,
  esi: createEditorEsiAdapter(() => _projectPath),
  versionControl: createEditorVersionControlAdapter(),
  navigation: createEditorNavigationAdapter(),
  library: createEditorLibraryAdapter(),
  stlibSource: createEditorStlibSourceAdapter(),
  // Paired with `requiresEdgeAccount: false` in EDITOR_CAPABILITIES, so signing in stays optional here.
  edgeAccount: editorEdgeAccountPort,
  editSession: editorEditSessionPort,
  // Wired unconditionally; visibility is gated by capabilities/consent/sign-in, not by the port's absence.
  ai: createEditorAIAdapter({
    // No build-time kill switch: the main process is the only route to AI endpoints, so an absent proxy already fails closed.
    isFeatureEnabled: true,
    hasUserConsented: hasAiConsent(),
    inlineCompletionsEnabled: readInlineCompletionsPreference(),
  }),
  capabilities: { ...EDITOR_CAPABILITIES, isDevMode: process.env.NODE_ENV === 'development' },
}

// Same localStorage key the shared consent modal writes; unreadable reads as "not accepted".
function hasAiConsent(): boolean {
  try {
    return localStorage.getItem('ai-consent-v1') === 'accepted'
  } catch {
    return false
  }
}

// Defaults to on (like the store) so a first run or unreadable value never silently disables the feature.
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
