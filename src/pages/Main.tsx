import { CONSTANTS } from '@shared/constants'
import { ipcRenderer } from 'electron'
import { FC, useCallback, useEffect, useState } from 'react'
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
import { xmlProject } from '@/types/xmlProject'
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
  const [pro, setPro] = useState<xmlProject | undefined>()
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
  const { projectXmlAsObj, setWorkspaceProject } = useStore(projectStore)
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
      if (pro?.project?.types?.pous) {
        const pouName = Object.entries(pro?.project?.types?.pous).map(
          ([key, value]) => {
            return value['@name']
          },
        )
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

  /**
   * Wip --------------------------------------------------------------------------------------> Start
   * || On the first launch of the application, gather basic project information.
   * || Then collecting them as they update to avoid having to reload everything every time
   * || we switch projects or tabs...
   * Wip --------------------------------------------------------------------------------------> End
   */
  // && Experimental block --------------------------------------------------------------------> Start
  // Function to handle response and display error toast
  const handleResponse = useCallback(
    ({ ok, data, reason }: GetProjectProps) => {
      if (!ok && reason) {
        createToast({ type: 'error', ...reason })
      } else if (ok && data) {
        // const { xmlSerializedAsObject } = data
        console.warn('Here -> ', data.xmlSerializedAsObject)
        setWorkspaceProject(data.xmlSerializedAsObject)
        setPro(data.xmlSerializedAsObject)
      }
    },
    [createToast, setWorkspaceProject],
  )

  // Custom hook to use an IPC channel to get the project
  const { invoke } = useIpcRender<string, GetProjectProps>({
    channel: get.PROJECT,
    callback: handleResponse,
  })

  // Function to get the project using the given path
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
    const getProjectByPath = async () => {
      const path = await ipcRenderer.invoke('info:workspace')
      console.log('Project path -> ', path.folder)
      if (path.folder === '') {
        console.log('Workspace does not has an initial folder')
      }
      const pathNormalized = path.folder.replace('/plc.xml', '') as string
      getProject(pathNormalized)
    }
    getProjectByPath()
  }, [getProject])

  // && Experimental block --------------------------------------------------------------------> End
  /**
   * Navigate to the main path if the project data is not available
   */
  useEffect(() => {
    if (projectXmlAsObj === null && pro === undefined) navigate(paths.MAIN)
  }, [navigate, pro, projectXmlAsObj])

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
