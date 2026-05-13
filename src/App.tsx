import '@xyflow/react/dist/style.css'
import 'tailwindcss/tailwind.css'
import './backend/shared/styles/globals.css'

import { useEffect } from 'react'

import { AppLayout } from './frontend/components/_templates/app-layout'
import { StartScreen } from './frontend/screens/start-screen'
import { WorkspaceScreen } from './frontend/screens/workspace-screen'
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
