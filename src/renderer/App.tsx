import 'tailwindcss/tailwind.css'
import './styles/globals.css'

import { RouterProvider, ToastProvider } from '@providers/index'

export default function App() {
  {
    /** Manage routing and navigation within the app. */
  }
  return (
    <ToastProvider>
      <RouterProvider />
    </ToastProvider>
  )
}
