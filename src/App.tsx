import { FC } from 'react'
import { ToastContainer } from 'react-toastify'
import { ReactFlowProvider } from 'reactflow'

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
            <ReactFlowProvider>
              <ModalProvider>
                <RouterProvider />
                <ToastContainer closeButton={false} closeOnClick={false} />
              </ModalProvider>
            </ReactFlowProvider>
          </TitlebarProvider>
        </ProjectProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}

export default App
