import '@xyflow/react/dist/style.css'
import 'tailwindcss/tailwind.css'
import './backend/shared/styles/globals.css'
// Monaco language + theme registrations (`openplc-dark` / `openplc-light`,
// ST / IL / Python LanguageConfigurations).  Imported here as a
// side-effect at app boot so EVERY Monaco editor in the app — body
// editor, variables text-mode editor, future LSP-driven views — sees
// the registered themes regardless of mount order.  Previously this
// import lived only inside the body editor's index.tsx, which meant
// any editor that mounted first (e.g. variables text-mode opened
// without the body editor) saw Monaco's default vs-dark theme.
import './frontend/components/_features/[workspace]/editor/monaco/configs'

// Resolve basedpyright's worker bundle URL through the host
// bundler.  Editor uses webpack with an `asset/resource` rule on
// `?url`; web uses Vite's native `?url` query.  The shared
// `startPythonLsp` requires this URL as an option — keeping the
// bundler-specific syntax pinned to the (non-byte-identical)
// `App.tsx` keeps the shared zone clean.  See
// `setPythonLspWorkerUrl` in monaco/python-lsp/index.ts.
import pyrightWorkerUrl from 'browser-basedpyright/dist/pyright.worker.js?url'
import { useEffect } from 'react'

import { setPythonLspWorkerUrl } from './frontend/components/_features/[workspace]/editor/monaco/python-lsp'
import { AppLayout } from './frontend/components/_templates/app-layout'
import { StartScreen } from './frontend/screens/start-screen'
import { WorkspaceScreen } from './frontend/screens/workspace-screen'
import { bootStLsp } from './frontend/services/st-lsp/boot'
import { openPLCStoreBase, useOpenPLCStore } from './frontend/store'
import { stlibsToSystemLibraries } from './frontend/utils/stlib-to-system-library'
import { editorPorts, setProjectPath, setRuntimeIpAddress } from './middleware/editor-platform'
import { PlatformProvider } from './middleware/shared/providers'

/**
 * Load every installed library (bundled + user-installed) at startup
 * and dispatch the parsed `SystemLibrary` shape into the Zustand
 * library slice.
 *
 * Runs as a top-level promise so libraries hydrate as early as
 * possible — usually before the first render that consumes them, but
 * the store starts with an empty `libraries.system` array regardless
 * and the library tree just renders progressively as entries arrive.
 * Errors bubble up to the console / dev tools; we don't fall back to
 * a hardcoded set because the .stlib files are the canonical source
 * of truth for library content.
 */
const hydrateLibraries = () => {
  // Two parallel calls: archives carry the full POU lists for the
  // tree builder, listInstalled carries the bundled flag (the
  // archive shape doesn't).  Both feed the same slice so the tree
  // and the manager stay in sync.
  Promise.all([editorPorts.library.loadAll(), editorPorts.library.listInstalled()])
    .then(([archives, installed]) => {
      const actions = openPLCStoreBase.getState().libraryActions
      actions.setSystemLibraries(stlibsToSystemLibraries(archives))
      actions.setBundledLibraryNames(installed.filter((l) => l.bundled).map((l) => l.name))
    })
    .catch((err) => {
      console.error('Failed to load .stlib libraries:', err)
    })
}
hydrateLibraries()
// Reload the in-memory pool whenever the main process reports an
// install/uninstall/CDN change.  Subscriber lives outside React to
// catch events fired before any component mounts.
editorPorts.library.onLibrariesChanged(() => hydrateLibraries())

// Register the basedpyright worker URL so the Monaco-side adapter
// can spin up the Python LSP on first POU open.  No service
// start yet — the LSP is lazy-initialised in
// `monaco/python-lsp/initPythonLSP` when Monaco mounts.
setPythonLspWorkerUrl(pyrightWorkerUrl)

// Pre-warm the STruC++ LSP worker so the first ST POU opens with
// completion + diagnostics already streaming.  `bootStLsp` returns
// null when the capability flag is off (web build before its
// adapter lands, jsdom test envs, …).  Lazy-import monaco-editor
// to avoid pulling its top-level side effects into modules that
// only need the boot wrapper.
void import('monaco-editor').then((monaco) => {
  bootStLsp(editorPorts, monaco)
})

export default function App() {
  const {
    project: {
      meta: { path },
    },
  } = useOpenPLCStore()

  // Sync store runtime IP to the platform adapter so the runtime port can access it
  const runtimeIpAddress = useOpenPLCStore((state) => state.deviceDefinitions.configuration.runtimeIpAddress || '')
  useEffect(() => {
    setRuntimeIpAddress(runtimeIpAddress)
  }, [runtimeIpAddress])

  // Sync project path to the platform adapter so the ESI port can access it
  const projectPath = useOpenPLCStore((state) => state.project.meta.path)
  useEffect(() => {
    setProjectPath(projectPath)
  }, [projectPath])

  return (
    <PlatformProvider ports={editorPorts}>
      <AppLayout>{path === '' ? <StartScreen /> : <WorkspaceScreen />}</AppLayout>
    </PlatformProvider>
  )
}
