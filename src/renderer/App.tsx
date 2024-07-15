import 'tailwindcss/tailwind.css'
import './styles/globals.css'

import { RouterProvider } from '@providers/index'
import { ReactFlowProvider } from '@xyflow/react'

export default function App() {
  {
    /** Manage routing and navigation within the app. */
  }
  return (
    <ReactFlowProvider>
      <RouterProvider />
    </ReactFlowProvider>
  )
}
