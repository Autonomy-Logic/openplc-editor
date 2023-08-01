import { Transition } from '@headlessui/react'
import { CONSTANTS } from '@shared/constants'
import { FC, ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FaDrawPolygon } from 'react-icons/fa'
import { HiOutlineSquares2X2 } from 'react-icons/hi2'
import {
  HiBars3,
  HiOutlineBars3CenterLeft,
  HiOutlineCog6Tooth,
  HiVariable,
} from 'react-icons/hi2'
import { RiNodeTree } from 'react-icons/ri'
import { ResizableBox, ResizeCallbackData } from 'react-resizable'
import { useLocation } from 'react-router-dom'

import { Tooltip } from '@/components'
import { CurrentProps } from '@/contexts/Sidebar'
import { useProject, useToggle } from '@/hooks'
import useSidebar from '@/hooks/useSidebar'
import { EditorTools, ProjectTree, Settings, Tools, Variables } from '@/pages'
import { classNames } from '@/utils'

const { languages, paths } = CONSTANTS

type LayoutProps = {
  main: ReactNode
}

const Layout: FC<LayoutProps> = ({ main }) => {
  const INITIAL_SIDEBAR_WIDTH = 384
  const { t } = useTranslation('navigation')
  const { project } = useProject()
  const { pathname } = useLocation()
  const { current, navigate } = useSidebar()
  const [isSidebarOpen, toggleIsSideBarOpen] = useToggle(true)
  const [sidebarWidth, setSidebarWidth] = useState(INITIAL_SIDEBAR_WIDTH)

  const handleClick = (key?: CurrentProps) => {
    if (!isSidebarOpen) toggleIsSideBarOpen()
    if (key) navigate(key)
  }

  const navigation = [
    {
      key: 'tools',
      name: t('tools'),
      onClick: handleClick,
      icon: HiOutlineSquares2X2,
      component: <Tools />,
    },
    ...(project?.xmlSerializedAsObject
      ? [
          {
            key: 'projectTree',
            name: t('project'),
            onClick: handleClick,
            icon: RiNodeTree,
            component: <ProjectTree />,
          },
        ]
      : []),
    ...(project?.language === languages.LD
      ? [
          {
            key: 'editorTools',
            name: t('editorTools'),
            onClick: handleClick,
            icon: FaDrawPolygon,
            component: <EditorTools />,
          },
        ]
      : []),
    ...(project && pathname.includes(paths.POU)
      ? [
          {
            key: 'variables',
            name: t('variables'),
            onClick: handleClick,
            icon: HiVariable,
            component: <Variables />,
          },
        ]
      : []),
    {
      key: 'settings',
      name: t('settings'),
      onClick: handleClick,
      icon: HiOutlineCog6Tooth,
      className: 'mt-auto',
      component: <Settings />,
    },
  ]

  const onResize = (data: ResizeCallbackData) =>
    setSidebarWidth(data.size.width)

  const getSidebar = () =>
    navigation.find(({ key }) => key === current)?.component

  return (
    <div className="flex h-full">
      <div className="flex h-full">
        <nav className="flex h-full w-20 flex-col items-center justify-between border-r border-gray-100 bg-white px-4 py-4 dark:border-white/5 dark:bg-gray-900">
          <ul className="mb-auto flex h-full flex-col items-center gap-2">
            {navigation.map(({ key, name, onClick, icon: Icon, className }) => (
              <li key={name} className={className}>
                <Tooltip id={name} label={name} place="right">
                  <button
                    className={classNames(
                      current === key
                        ? 'bg-blue-100 text-open-plc-blue dark:bg-gray-800'
                        : 'text-gray-500 hover:bg-blue-100 hover:text-open-plc-blue dark:hover:bg-gray-800',
                      'group flex gap-x-3 rounded-md p-3 text-sm font-semibold leading-6',
                    )}
                    onClick={() => onClick(key as CurrentProps)}
                  >
                    <Icon className="h-6 w-6 shrink-0" aria-hidden="true" />
                    <span className="sr-only">{name}</span>
                  </button>
                </Tooltip>
              </li>
            ))}
          </ul>
          <button
            onClick={() => toggleIsSideBarOpen()}
            className="group flex gap-x-3 rounded-md p-3 text-sm font-semibold leading-6 text-gray-500 hover:text-open-plc-blue"
          >
            {isSidebarOpen ? (
              <HiOutlineBars3CenterLeft className="h-6 w-6 shrink-0" />
            ) : (
              <HiBars3 className="h-6 w-6 shrink-0" />
            )}
          </button>
        </nav>

        <Transition show={isSidebarOpen}>
          <ResizableBox
            width={sidebarWidth}
            height={Infinity}
            className="h-full border-r border-gray-100 bg-white px-8 shadow dark:border-white/5 dark:bg-gray-900"
            minConstraints={[INITIAL_SIDEBAR_WIDTH, Infinity]}
            resizeHandles={['e']}
            axis="x"
            onResize={(_, data) => onResize(data)}
          >
            {getSidebar()}
          </ResizableBox>
        </Transition>
      </div>

      <main className="h-full w-full bg-gray-100 px-8 py-6 dark:bg-gray-800">
        {main}
      </main>
    </div>
  )
}

export default Layout
