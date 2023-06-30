import { CONSTANTS } from '@shared/constants'
import { FC, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

import { useIpcRender, useModal, useProject } from '@/hooks'
import { Home as HomeTemplate } from '@/templates'
import { convertToPath } from '@/utils'

import CreatePOU from '../components/CreatePOU'

const {
  channels: { get },
  paths,
} = CONSTANTS
const Home: FC = () => {
  const navigate = useNavigate()
  const { project } = useProject()
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
    if (project?.xmlSerialized) navigate(convertToPath([paths.PROJECT_TREE]))
  }, [navigate, project])

  return <HomeTemplate />
}

export default Home
