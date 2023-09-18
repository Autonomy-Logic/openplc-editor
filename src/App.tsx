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
// Define the main application component.
const App: FC = () => {
  return (
    // Wrap the entire application with a theme provider to manage styling.
    <ThemeProvider>
      {/** Provide context for toast notifications throughout the app. */}
      <ToastProvider>
        {/** Manage project-related state and data with this context. */}
        <ProjectProvider>
          {/** Manage the application title bar with this context */}
          <TitlebarProvider>
            {/** Provide React Flow diagram functionality. */}
            <ReactFlowProvider>
              <ReactFlowElementsProvider>
                {/** Manage modal-related state and actions with this context. */}
                <ModalProvider>
                  {/** Enable HTML5-based drag-and-drop functionality. */}
                  <DndProvider backend={HTML5Backend}>
                    {/** Manage routing and navigation within the app. */}
                    <RouterProvider />
                  </DndProvider>
                  {/** Displays toast notification using the ToastContainer component. */}
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
