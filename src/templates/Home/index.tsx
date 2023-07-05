import { CONSTANTS } from '@shared/constants'
import { FC, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import {
  HiBars3,
  HiOutlineBars3CenterLeft,
  HiOutlineCog6Tooth,
  HiOutlineSquares2X2,
} from 'react-icons/hi2'
import { RiNodeTree } from 'react-icons/ri'
import { Link, Outlet, useLocation } from 'react-router-dom'

import { Tooltip } from '@/components'
import { useFullScreen, useProject, useToggle } from '@/hooks'
import { classNames, convertToPath } from '@/utils'

const { paths } = CONSTANTS

const Home: FC = () => {
  const { t } = useTranslation('sidebar')
  const { pathname } = useLocation()
  const { project } = useProject()
  const { isFullScreen } = useFullScreen()
  const [isSidebarOpen, toggleIsSideBarOpen] = useToggle(true)

  const navigation = [
    {
      name: t('tools'),
      to: convertToPath([paths.TOOLS]),
      icon: HiOutlineSquares2X2,
    },
    ...(project?.xmlSerialized
      ? [
          {
            name: t('project'),
            to: convertToPath([paths.PROJECT_TREE]),
            icon: RiNodeTree,
          },
        ]
      : []),
  ]

  const handleClickLink = () => {
    if (!isSidebarOpen) toggleIsSideBarOpen()
  }

  return (
    <>
      <div
        className={classNames(
          'layout',
          isFullScreen ? 'z-50 h-screen' : 'h-[calc(100vh_-_4rem)]',
        )}
      >
        <div className="sidebar z-10 w-20 overflow-y-auto border-r border-gray-100 bg-white px-4 dark:border-white/5 dark:bg-gray-900">
          <nav className="flex h-full flex-col items-center py-4">
            <ul className="mb-auto flex flex-col items-center space-y-1">
              {navigation.map(({ name, to, icon: Icon }) => (
                <li key={name}>
                  <Tooltip id={name} label={name} place="right">
                    <Link to={to}>
                      <button
                        className={classNames(
                          pathname === to
                            ? 'bg-blue-100 text-open-plc-blue dark:bg-gray-800'
                            : 'text-gray-500 hover:bg-blue-100 hover:text-open-plc-blue dark:hover:bg-gray-800',
                          'group flex gap-x-3 rounded-md p-3 text-sm font-semibold leading-6',
                        )}
                        onClick={handleClickLink}
                      >
                        <Icon className="h-6 w-6 shrink-0" aria-hidden="true" />
                        <span className="sr-only">{name}</span>
                      </button>
                    </Link>
                  </Tooltip>
                </li>
              ))}
            </ul>
            <Tooltip id={t('settings')} label={t('settings')} place="right">
              <Link to={convertToPath([paths.SETTINGS, paths.THEME])}>
                <button
                  className={classNames(
                    pathname.includes('settings')
                      ? 'bg-blue-100 text-open-plc-blue dark:bg-gray-800'
                      : 'text-gray-500 hover:bg-blue-100 hover:text-open-plc-blue dark:hover:bg-gray-800',
                    'group flex gap-x-3 rounded-md p-3 text-sm font-semibold leading-6',
                  )}
                  onClick={handleClickLink}
                >
                  <HiOutlineCog6Tooth
                    className="h-6 w-6 shrink-0"
                    aria-hidden="true"
                  />
                  <span className="sr-only">settings</span>
                </button>
              </Link>
            </Tooltip>
            <button
              onClick={toggleIsSideBarOpen}
              className="group flex gap-x-3 rounded-md p-3 text-sm font-semibold leading-6 text-gray-500 hover:text-open-plc-blue"
            >
              {isSidebarOpen ? (
                <HiOutlineBars3CenterLeft className="h-6 w-6 shrink-0" />
              ) : (
                <HiBars3 className="h-6 w-6 shrink-0" />
              )}
            </button>
          </nav>
        </div>
        <aside
          className={classNames(
            'secondary-sidebar transition-left absolute h-full w-96 overflow-y-auto border-r border-gray-100 bg-white px-8 shadow duration-500 dark:border-white/5 dark:bg-gray-900',
            isSidebarOpen ? 'left-20' : '-left-96',
          )}
        >
          <Outlet />
        </aside>
        <main className="main-content bg-gray-100 px-8 py-6 dark:bg-gray-800"></main>
      </div>
    </>
  )
}

export default Home
