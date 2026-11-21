import { APP_VERSION } from '../frontend/data/constants/app-version'
import type { OpenPLCStore } from '../frontend/store'
import { createEditorAcceleratorAdapter } from './adapters/editor/accelerator-adapter'
import { createEditorAIAdapter } from './adapters/editor/ai-adapter'
import { createEditorAppUpdateAdapter } from './adapters/editor/app-update-adapter'
import { createEditorCompilerAdapter } from './adapters/editor/compiler-adapter'
import { createEditorDebuggerAdapter } from './adapters/editor/debugger-adapter'
import { createEditorDeviceAdapter } from './adapters/editor/device-adapter'
import { editorEdgeAccountPort } from './adapters/editor/edge-account-adapter'
import { editorEditSessionPort } from './adapters/editor/edit-session-adapter'
import { createEditorEsiAdapter } from './adapters/editor/esi-adapter'
import { createEditorEtherCATDiagnosticsAdapter } from './adapters/editor/ethercat-diagnostics-adapter'
import { createEditorEtherCATScanAdapter } from './adapters/editor/ethercat-scan-adapter'
import { createEditorLibraryAdapter } from './adapters/editor/library-adapter'
import { createEditorNavigationAdapter } from './adapters/editor/navigation-adapter'
import { openFetchedProject } from './adapters/editor/open-fetched-project'
import { createEditorOrchestratorAdapter } from './adapters/editor/orchestrator-adapter'
import { createEditorPackageAdapter } from './adapters/editor/package-adapter'
import { createPackageUpdateNotifier } from './adapters/editor/package-update-notice'
import { createEditorProjectAdapter } from './adapters/editor/project-adapter'
import { createEditorRuntimeAdapter } from './adapters/editor/runtime-adapter'
import { createEditorRuntimeProvisioningAdapter } from './adapters/editor/runtime-provisioning-adapter'
import { createEditorSimulatorAdapter } from './adapters/editor/simulator-adapter'
import { createEditorStlibSourceAdapter } from './adapters/editor/stlib-source-adapter'
import { createEditorSystemAdapter } from './adapters/editor/system-adapter'
import { createEditorThemeAdapter } from './adapters/editor/theme-adapter'
import { createEditorVersionControlAdapter } from './adapters/editor/version-control-adapter'
import { createEditorWindowAdapter } from './adapters/editor/window-adapter'
import { EDITOR_CAPABILITIES } from './shared/ports/platform-capabilities'
import type { PlatformPorts } from './shared/providers/types'

let _runtimeIpAddress = ''
let _projectPath = ''

export function setRuntimeIpAddress(ip: string): void {
  _runtimeIpAddress = ip
}

const projectPathListeners = new Set<() => void>()

export function setProjectPath(path: string): void {
  if (path === _projectPath) return
  _projectPath = path
  for (const listener of projectPathListeners) listener()
}

/** Subscribe to project switches; returns the unsubscribe. */
function onProjectPathChanged(listener: () => void): () => void {
  projectPathListeners.add(listener)
  return () => projectPathListeners.delete(listener)
}

const editorPackages = createEditorPackageAdapter()

export const packageUpdateNotifier = createPackageUpdateNotifier(editorPackages, APP_VERSION)

/**
 * Editor platform ports — all port interfaces wired to Electron IPC bridge.
 */
export function createEditorPorts(store: OpenPLCStore): PlatformPorts {
  const editorProject = createEditorProjectAdapter(store)
  const editorRuntime = createEditorRuntimeAdapter(store, () => _runtimeIpAddress)
  editorRuntime.openFetchedProject = (project) => openFetchedProject(store, project, editorProject)

  return {
    compiler: createEditorCompilerAdapter({
      findPackageUpdateNotice: (packageId) => packageUpdateNotifier.notice(packageId),
    }),
    runtime: editorRuntime,
    runtimeProvisioning: createEditorRuntimeProvisioningAdapter(),
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
    esi: createEditorEsiAdapter(() => _projectPath, onProjectPathChanged),
    ethercatScan: createEditorEtherCATScanAdapter({ getRuntimeIp: () => _runtimeIpAddress }),
    ethercatDiagnostics: createEditorEtherCATDiagnosticsAdapter({ getRuntimeIp: () => _runtimeIpAddress }),
    versionControl: createEditorVersionControlAdapter(),
    navigation: createEditorNavigationAdapter(store),
    library: createEditorLibraryAdapter(),
    stlibSource: createEditorStlibSourceAdapter(),
    edgeAccount: editorEdgeAccountPort,
    editSession: editorEditSessionPort,
    appUpdate: createEditorAppUpdateAdapter(),
    ai: createEditorAIAdapter({
      isFeatureEnabled: true,
      hasUserConsented: hasAiConsent(),
      inlineCompletionsEnabled: readInlineCompletionsPreference(),
    }),
    capabilities: { ...EDITOR_CAPABILITIES, isDevMode: process.env.NODE_ENV === 'development' },
  }
}

// Same localStorage key the shared consent modal writes; unreadable reads as "not accepted".
function hasAiConsent(): boolean {
  try {
    return localStorage.getItem('ai-consent-v1') === 'accepted'
  } catch {
    return false
  }
}

// Defaults to on when the value is absent or unreadable.
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
