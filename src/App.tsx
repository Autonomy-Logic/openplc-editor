import { FC } from 'react'
import { ToastContainer } from 'react-toastify'

import {
  ModalProvider,
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
            <ModalProvider>
              <RouterProvider />
              <ToastContainer closeButton={false} closeOnClick={false} />
            </ModalProvider>
          </TitlebarProvider>
        </ProjectProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}

export default App
