import '@xyflow/react/dist/style.css'
import 'tailwindcss/tailwind.css'
import './backend/styles/globals.css'

import { AppLayout } from './frontend/components/_templates/app-layout'
import { StartScreen } from './frontend/screens/start-screen'
import { WorkspaceScreen } from './frontend/screens/workspace-screen'
import { useOpenPLCStore } from './frontend/store'
import { editorPorts } from './middleware/editor-platform'
import { PlatformProvider } from './middleware/shared/providers'

export default function App() {
  const {
    project: {
      meta: { path },
    },
  } = useOpenPLCStore()

  return (
    <PlatformProvider ports={editorPorts}>
      <AppLayout>{path === '' ? <StartScreen /> : <WorkspaceScreen />}</AppLayout>
    </PlatformProvider>
  )
}
