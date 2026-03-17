import '@xyflow/react/dist/style.css'
import 'tailwindcss/tailwind.css'
import './backend/styles/globals.css'

import { useEffect } from 'react'

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
import { editorPorts, setRuntimeIpAddress } from './middleware/editor-platform'
import { PlatformProvider } from './middleware/shared/providers'

// Initialize system libraries at module load time (before first render)
openPLCStoreBase
  .getState()
  .libraryActions.setSystemLibraries([
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

  // Sync store runtime IP to the platform adapter so the runtime port can access it
  const runtimeIpAddress = useOpenPLCStore(
    (state) => state.deviceDefinitions.configuration.runtimeIpAddress || '',
  )
  useEffect(() => {
    setRuntimeIpAddress(runtimeIpAddress)
  }, [runtimeIpAddress])

  return (
    <PlatformProvider ports={editorPorts}>
      <AppLayout>{path === '' ? <StartScreen /> : <WorkspaceScreen />}</AppLayout>
    </PlatformProvider>
  )
}
