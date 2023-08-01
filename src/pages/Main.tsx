import { CONSTANTS } from '@shared/constants'
import { FC, useEffect } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'

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
import { Layout } from '@/templates'
import { convertToPath } from '@/utils'

import CreatePOU from '../components/CreatePOU'

const {
  channels: { get },
  paths,
} = CONSTANTS

const MainComponent: FC = () => {
  const navigate = useNavigate()
  const { navigate: sidebarNavigate } = useSidebar()
  const { project, getXmlSerializedValueByPath } = useProject()
  const { addTab } = useTabs()
  const { theme } = useTheme()
  const { titlebar } = useTitlebar()
  const { handleOpenModal } = useModal({
    content: <CreatePOU />,
    hideCloseButton: true,
  })

  useIpcRender<undefined, void>({
    channel: get.CREATE_POU_WINDOW,
    callback: () => handleOpenModal(),
  })

  useEffect(() => {
    const pouName = getXmlSerializedValueByPath(
      'project.types.pous.pou.@name',
    ) as string

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

  useEffect(() => {
    if (!project?.xmlSerializedAsObject) navigate(paths.MAIN)
  }, [navigate, project?.xmlSerializedAsObject])

  if (!theme || !titlebar) return <></>

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
