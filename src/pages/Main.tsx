import { CONSTANTS } from '@shared/constants'
import { FC, useEffect } from 'react'
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
} from '@/hooks'
import useSidebar from '@/hooks/useSidebar'
import projectStore from '@/stores/Project'
import { Layout } from '@/templates'
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
    const pouName = getXmlSerializedValueByPath('types.pous.pou') as string

    if (pouName) {
      sidebarNavigate('projectTree')
      addTab({
        id: pouName,
        title: pouName,
        onClick: () => navigate(convertToPath([paths.POU, pouName])),
        onClickCloseButton: () => navigate(paths.MAIN),
      })
      navigate(convertToPath([paths.POU, pouName]))
    }
  }, [addTab, getXmlSerializedValueByPath, navigate, sidebarNavigate])
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
