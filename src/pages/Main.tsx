import { CONSTANTS } from '@shared/constants'
import { FC, useCallback, useEffect } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { useStore } from 'zustand'

import { SidebarProvider, TabsProvider } from '@/contexts'
import {
  useIpcRender,
  useModal,
  useProject,
  useTabs,
  useTheme,
  useTitlebar,
  useToast,
} from '@/hooks'
import useSidebar from '@/hooks/useSidebar'
import pouStore from '@/stores/Pou'
import projectStore from '@/stores/Project'
import { Layout } from '@/templates'
import { GetProjectProps } from '@/types/dtos/getProject.dto'
import { convertToPath } from '@/utils'

import CreatePOU from '../components/CreatePouForm'
/**
 * Destructure necessary values from the CONSTANTS module
 */
const {
  channels: { get },
  paths,
} = CONSTANTS
/**
 * Main functional component for the application
 * @component
 */
const MainComponent: FC = () => {
  /**
   * Access the navigate function from 'react-router-dom'
   * @useNavigate
   */
  const navigate = useNavigate()
  /**
   * Access the navigate function from the useSidebar custom hook
   * @useSidebar
   */
  const { navigate: sidebarNavigate } = useSidebar()
  /**
   * Access project-related functions and values from the custom hook
   * @useProject
   */
  const { getXmlSerializedValueByPath } = useProject()
  /**
   * && Experimental: Using project store
   */
  const { projectXmlAsObj } = useStore(projectStore)
  /**
   * && Experimental: Using pous directly from pouStore for debug purposes.
   * Todo: Remove
   */
  const { createToast } = useToast()

  /**
   * Access tab-related functions from the custom hook
   * @useTabs
   */
  const { addTab } = useTabs()
  /**
   * Access theme-related functions and values from the custom hook
   * @useTheme
   */
  const { theme } = useTheme()
  /**
   * Access titlebar-related functions and values from the custom hook
   * @useTitlebar
   */
  const { titlebar } = useTitlebar()
  /**
   * Access modal-related functions from the custom hook and open a modal for creating a POU
   * @useModal
   */
  const { handleOpenModal } = useModal({
    content: <CreatePOU />,
    hideCloseButton: true,
  })
  /**
   * Listen for IPC render event to open the CreatePOU modal
   */
  useIpcRender<undefined, void>({
    channel: get.CREATE_POU_WINDOW,
    callback: () => handleOpenModal(),
  })
  /**
   * Handle navigation and tab addition based on POU data
   */
  useEffect(() => {
    const setPousPath = () => {
      if (projectXmlAsObj?.project?.types?.pous) {
        const pouName = Object.entries(
          projectXmlAsObj?.project?.types?.pous,
        ).map(([key, value]) => {
          return value['@name']
        })
        sidebarNavigate('projectTree')
        pouName.map((p) => {
          addTab({
            id: p,
            title: p,
            onClick: () => navigate(convertToPath([paths.POU, p])),
            onClickCloseButton: () => navigate(paths.MAIN),
          })
        })
        navigate(convertToPath([paths.POU, pouName[0]]))
      }
    }
    setPousPath()
  }, [addTab, navigate, projectXmlAsObj, sidebarNavigate])

  // && Experimental block --------------------------------------------------------------------> Start
  const projectPath = invoke(get.PROJECT_PATH)
  // Function to handle response and display error toast
  const handleResponse = useCallback(
    ({ ok, data, reason }: GetProjectProps) => {
      if (!ok && reason) {
        createToast({ type: 'error', ...reason })
      } else if (ok && data) {
        //const { xmlProject, filePath } = data
        console.warn('Here -> ', data)
      }
    },
    [createToast],
  )

  const { invoke } = useIpcRender<string, GetProjectProps>({
    channel: get.PROJECT,
    callback: handleResponse,
  })

  // todo: Resolve this code block
  // ? What is missing? What is doing?

  const getProject = useCallback(
    async (path: string) => {
      try {
        const response = await invoke(get.PROJECT, path)
        handleResponse(response)
      } catch (error) {
        // Handle any other errors if needed
        console.error(error)
      }
    },
    [handleResponse, invoke],
  )
  useEffect(() => {
    getProject()
  }, [])

  // && Experimental block --------------------------------------------------------------------> End
  /**
   * Navigate to the main path if the project data is not available
   */
  useEffect(() => {
    if (!projectXmlAsObj) navigate(paths.MAIN)
  }, [navigate, projectXmlAsObj])

  if (!theme || !titlebar) return <></>

  return <Layout main={<Outlet />} />
}
/**
 * Wrapper component providing context providers for tabs and sidebar
 * @component
 */
const Main: FC = () => (
  <TabsProvider>
    <SidebarProvider>
      <MainComponent />
    </SidebarProvider>
  </TabsProvider>
)

export default Main
