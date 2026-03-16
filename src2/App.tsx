import '@xyflow/react/dist/style.css'
import 'tailwindcss/tailwind.css'
import './backend/styles/globals.css'

import { AppLayout } from './frontend/components/_templates/app-layout'
import {
  AdditionalFunctionBlocks,
  ArduinoFunctionBlocks,
  Arithmetic,
  BitShift,
  Bitwise,
  CharacterString,
  CommunicationBlocks,
  Comparison,
  Jaguar,
  MQTT,
  Numerical,
  P1AM,
  Selection,
  SequentMicrosystemsModules,
  StandardFunctionBlocks,
  Time,
  TypeConversion,
} from './frontend/data/library'
import { StartScreen } from './frontend/screens/start-screen'
import { WorkspaceScreen } from './frontend/screens/workspace-screen'
import { openPLCStoreBase, useOpenPLCStore } from './frontend/store'
import { editorPorts } from './middleware/editor-platform'
import { PlatformProvider } from './middleware/shared/providers'

// Initialize system libraries at module load time (before first render)
openPLCStoreBase.getState().libraryActions.setSystemLibraries([
  AdditionalFunctionBlocks,
  ArduinoFunctionBlocks,
  CommunicationBlocks,
  Jaguar,
  MQTT,
  P1AM,
  SequentMicrosystemsModules,
  StandardFunctionBlocks,
  Arithmetic,
  BitShift,
  Bitwise,
  CharacterString,
  Comparison,
  Numerical,
  Selection,
  Time,
  TypeConversion,
])

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
