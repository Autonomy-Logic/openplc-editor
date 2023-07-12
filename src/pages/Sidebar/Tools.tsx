import { CONSTANTS } from '@shared/constants'
import { FC, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { IconType } from 'react-icons'
import {
  HiArrowDownOnSquareStack,
  HiArrowDownTray,
  HiArrowsPointingIn,
  HiArrowsPointingOut,
  HiArrowUturnLeft,
  HiArrowUturnRight,
  HiClipboard,
  HiDocumentDuplicate,
  HiDocumentMagnifyingGlass,
  HiDocumentPlus,
  HiFolderOpen,
  HiPrinter,
  HiScissors,
} from 'react-icons/hi2'

import { CreatePOU, Tabs, Tooltip } from '@/components'
import {
  useFullScreen,
  useIpcRender,
  useModal,
  useProject,
  useToast,
} from '@/hooks'

const {
  channels: { set },
} = CONSTANTS

type CreateProjectFromToolbarProps = {
  ok: boolean
  reason?: { title: string; description?: string }
  data?: string
}

export type ToolsProps = {
  id: number
  icon: IconType
  className?: string
  onClick?: () => void
  tooltip: string
}

const Tools: FC = () => {
  const { t } = useTranslation('tools')
  const { createToast } = useToast()
  const { requestFullscreen, exitFullScreen, isFullScreen } = useFullScreen()
  const { invoke: createProjectFromToolbar } = useIpcRender<
    undefined,
    CreateProjectFromToolbarProps
  >()
  const { getProject } = useProject()
  const { handleOpenModal } = useModal({
    content: <CreatePOU />,
    hideCloseButton: true,
  })

  const onClick = () => console.log('will be created soon')

  const handleCreateProjectFromToolbar = async () => {
    const { ok, reason, data } = await createProjectFromToolbar(
      set.CREATE_PROJECT_FROM_TOOLBAR,
    )
    if (!ok && reason) {
      createToast({
        type: 'error',
        ...reason,
      })
    } else if (ok && data) {
      handleOpenModal()
      await getProject(data)
    }
  }

  const tools: ToolsProps[] = [
    {
      id: 1,
      onClick: handleCreateProjectFromToolbar,
      icon: HiDocumentPlus,
      tooltip: t('menuToolbar.new'),
    },
    {
      id: 2,
      onClick,
      icon: HiFolderOpen,
      tooltip: t('menuToolbar.open'),
    },
    {
      id: 3,
      onClick,
      icon: HiArrowDownTray,
      tooltip: t('menuToolbar.save'),
    },
    {
      id: 4,
      onClick,
      icon: HiArrowDownOnSquareStack,
      tooltip: t('menuToolbar.saveAs'),
    },
    {
      id: 5,
      onClick,
      icon: HiPrinter,
      tooltip: t('menuToolbar.print'),
    },
    {
      id: 6,
      onClick,
      icon: HiArrowUturnLeft,
      tooltip: t('menuToolbar.undo'),
    },
    {
      id: 7,
      onClick,
      icon: HiArrowUturnRight,
      tooltip: t('menuToolbar.redo'),
    },
    {
      id: 8,
      onClick,
      icon: HiScissors,
      tooltip: t('menuToolbar.cut'),
    },
    {
      id: 9,
      onClick,
      icon: HiDocumentDuplicate,
      tooltip: t('menuToolbar.copy'),
    },
    {
      id: 10,
      onClick,
      icon: HiClipboard,
      tooltip: t('menuToolbar.paste'),
    },
    {
      id: 11,
      onClick,
      icon: HiDocumentMagnifyingGlass,
      tooltip: t('menuToolbar.search'),
    },
    {
      id: 12,
      onClick: () => (isFullScreen ? exitFullScreen() : requestFullscreen()),
      icon: isFullScreen ? HiArrowsPointingIn : HiArrowsPointingOut,
      tooltip: t('menuToolbar.fullScreen'),
    },
  ]

  return (
    <>
      <Tabs
        tabs={[
          {
            id: t('common.tabName'),
            title: t('common.tabName'),
            current: true,
          },
        ]}
      />
      <div className="mt-10 grid grid-cols-6 gap-4">
        {tools.map(({ id, onClick, icon: Icon, className, tooltip }) => (
          <Fragment key={id}>
            <Tooltip id={tooltip} label={tooltip} place="bottom">
              <button
                className="press-animated border-none outline-none"
                onClick={() => onClick && onClick()}
              >
                <Icon
                  className={`h-6 w-6 text-gray-500 hover:opacity-90 ${className}`}
                />
              </button>
            </Tooltip>
          </Fragment>
        ))}
      </div>
    </>
  )
}

export default Tools
