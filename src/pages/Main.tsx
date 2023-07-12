import { CONSTANTS } from '@shared/constants'
import { FC, useEffect } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'

import { SidebarProvider, TabsProvider } from '@/contexts'
import { useIpcRender, useModal, useProject, useTabs, useTheme } from '@/hooks'
import useSidebar from '@/hooks/useSidebar'
import { Layout } from '@/templates'
import { convertToPath } from '@/utils'

import CreatePOU from '../components/CreatePOU'

const {
  channels: { get },
  paths,
} = CONSTANTS

const MainComponent: FC = () => {
  const navigate = useNavigate()
  const { theme } = useTheme()
  const { navigate: sidebarNavigate } = useSidebar()
  const { project } = useProject()
  const { addTab } = useTabs()
  const { handleOpenModal } = useModal({
    content: <CreatePOU />,
    hideCloseButton: true,
  })

  useIpcRender<undefined, boolean>({
    channel: get.CREATE_POU_WINDOW,
    callback: (createPOUWindow) => {
      if (createPOUWindow) handleOpenModal()
    },
  })

  useEffect(() => {
    const pouName = project?.xmlSerialized?.project?.types?.pous.pou?.['@name']
    if (pouName) {
      sidebarNavigate('projectTree')
      navigate(convertToPath([paths.POU, pouName]))
      addTab({
        id: pouName,
        title: pouName,
        onClick: () => navigate(convertToPath([paths.POU, pouName])),
        onClickCloseButton: () => navigate(paths.MAIN),
      })
    }
  }, [
    addTab,
    navigate,
    project?.xmlSerialized?.project?.types?.pous.pou,
    sidebarNavigate,
  ])

  if (!theme) return <></>

  return <Layout main={<Outlet />} />
}

const Main: FC = () => (
  <TabsProvider>
    <SidebarProvider>
      <MainComponent />
    </SidebarProvider>
  </TabsProvider>
)

export default Main
