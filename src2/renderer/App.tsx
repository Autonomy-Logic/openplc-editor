import '@xyflow/react/dist/style.css'
import 'tailwindcss/tailwind.css'
import './styles/globals.css'

import { PlatformProvider } from '../providers/platform'
import { editorPorts } from '../adapters/editor-platform'

/**
 * src2 App root — wires PlatformProvider with editor adapter ports.
 *
 * During migration, components are progressively moved from src/ to src2/.
 * Unmigrated ports will throw descriptive errors when called — this is
 * intentional so you know exactly what still needs implementation.
 *
 * As components are migrated, replace the placeholder below with real screens:
 *
 *   import { AppLayout } from '../components/_templates'
 *   import { StartScreen, WorkspaceScreen } from '../components/screens'
 *   import { useOpenPLCStore } from '../store'
 *
 *   const { project: { meta: { path } } } = useOpenPLCStore()
 *   return (
 *     <PlatformProvider ports={editorPorts}>
 *       <AppLayout>
 *         {path === '' ? <StartScreen /> : <WorkspaceScreen />}
 *       </AppLayout>
 *     </PlatformProvider>
 *   )
 */
export default function App() {
  return (
    <PlatformProvider ports={editorPorts}>
      <div className="flex h-full items-center justify-center bg-neutral-950 text-white">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">OpenPLC Editor (src2)</h1>
          <p className="mt-2 text-neutral-400">
            Migration in progress. Replace this placeholder as components are migrated.
          </p>
        </div>
      </div>
    </PlatformProvider>
  )
}
