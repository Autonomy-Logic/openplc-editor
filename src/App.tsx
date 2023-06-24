import { FC } from 'react'
import { ToastContainer } from 'react-toastify'

import {
  ProjectProvider,
  RouterProvider,
  ThemeProvider,
  TitlebarProvider,
  ToastProvider,
} from './contexts'

const App: FC = () => {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ProjectProvider>
          <TitlebarProvider>
            <RouterProvider />
            <ToastContainer closeButton={false} closeOnClick={false} />
          </TitlebarProvider>
        </ProjectProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}

export default App
