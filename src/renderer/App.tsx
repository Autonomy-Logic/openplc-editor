import '@xyflow/react/dist/style.css'
import 'tailwindcss/tailwind.css'
import './styles/globals.css'

import { AppLayout } from './components/_templates'
import { StartScreen, WorkspaceScreen } from './screens'
import { useOpenPLCStore } from './store'

export default function App() {
  const {
    project: {
      meta: { path },
    },
  } = useOpenPLCStore()
  {
    /** Manage routing and navigation within the app. */
  }
  return <AppLayout>{path === '' ? <StartScreen /> : <WorkspaceScreen />}</AppLayout>
}
