import { FC } from 'react'
import { ToastContainer } from 'react-toastify'

import {
  ModalProvider,
  ProjectProvider,
  RouterProvider,
  TabsProvider,
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
              <TabsProvider>
                <RouterProvider />
                <ToastContainer closeButton={false} closeOnClick={false} />
              </TabsProvider>
            </ModalProvider>
          </TitlebarProvider>
        </ProjectProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}

export default App
