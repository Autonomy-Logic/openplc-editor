import { CONSTANTS } from '@shared/constants'
import { ipcRenderer } from 'electron'
import { FC, useCallback, useEffect } from 'react'
import { DndProvider } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import { ToastContainer } from 'react-toastify'
import { ReactFlowProvider } from 'reactflow'
import { useStore } from 'zustand'

import {
  ModalProvider,
  ProjectProvider,
  ReactFlowElementsProvider,
  RouterProvider,
  ThemeProvider,
  TitlebarProvider,
  ToastProvider,
} from './contexts'
import projectStore from './stores/Project'
// Define the main application component.
const App: FC = () => {
  // || Reading and loading the current project based on workspace file path.
  // todo: Some rule is being broken and the program is crashing. Need to be fixed.
  // Wip ------------------------------------------------------------------------------------> Start
  const { setWorkspaceProject, filePath } = useStore(projectStore)
  useEffect(() => {
    const verifyIfWorkspaceHasProject = async () => {
      const path = await ipcRenderer.invoke('info:workspace')
      if (path.folder) {
        try {
          const pathNormalized = path.folder as string
          const result = await ipcRenderer.invoke(
            CONSTANTS.channels.get.PROJECT,
            pathNormalized,
          )
          const dataToProject = result.data.xmlSerializedAsObject
          setWorkspaceProject({
            filePath: pathNormalized,
            projectXmlAsObj: dataToProject,
          })
        } catch (err) {
          console.log(err)
        }
      }
    }
    verifyIfWorkspaceHasProject()
    ipcRenderer.on('info:workspace-updated', (_, workspaceUpdatedData) => {
      console.log(workspaceUpdatedData)
    })
    return () => {
      setWorkspaceProject({ filePath: null, projectXmlAsObj: null })
    }
  }, [filePath, setWorkspaceProject])
  // Wip ------------------------------------------------------------------------------------> End
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
