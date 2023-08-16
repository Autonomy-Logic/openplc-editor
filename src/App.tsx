import { FC } from 'react'
import { DndProvider } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import { ToastContainer } from 'react-toastify'
import { ReactFlowProvider } from 'reactflow'

import {
  ModalProvider,
  ProjectProvider,
  ReactFlowElementsProvider,
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
              <ReactFlowElementsProvider>
                <ModalProvider>
                  <DndProvider backend={HTML5Backend}>
                    <RouterProvider />
                  </DndProvider>
                  <ToastContainer closeButton={false} closeOnClick={false} />
                </ModalProvider>
              </ReactFlowElementsProvider>
            </ReactFlowProvider>
          </TitlebarProvider>
        </ProjectProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}

export default App
