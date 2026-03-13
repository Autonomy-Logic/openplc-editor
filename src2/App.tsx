import '@xyflow/react/dist/style.css'
import 'tailwindcss/tailwind.css'
import './backend/styles/globals.css'

import { AppLayout } from './frontend/components/_templates'
import { StartScreen, WorkspaceScreen } from './frontend/screens'
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
