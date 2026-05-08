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
 * Load every bundled .stlib library at startup and dispatch the parsed
 * `SystemLibrary` shape into the Zustand library slice.
 *
 * Runs as a top-level promise so libraries hydrate as early as possible
 * — usually before the first render that consumes them, but the store
 * starts with an empty `libraries.system` array regardless and the
 * library tree just renders progressively as entries arrive. Errors
 * bubble up to the console / dev tools; we don't fall back to a
 * hardcoded set because the .stlib files are the canonical source of
 * truth for library content.
 */
void editorPorts.library
  .loadBundledLibraries()
  .then((archives) => {
    openPLCStoreBase
      .getState()
      .libraryActions.setSystemLibraries(stlibsToSystemLibraries(archives))
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to load bundled .stlib libraries:', err)
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
