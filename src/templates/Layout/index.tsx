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
import { useStore } from 'zustand'

import { Tooltip } from '@/components'
import { CurrentProps } from '@/contexts/Sidebar'
import { useToggle } from '@/hooks'
import useSidebar from '@/hooks/useSidebar'
import { EditorTools, ProjectTree, Settings, Tools, Variables } from '@/pages'
import projectStore from '@/stores/Project'
import { classNames } from '@/utils'

// Extract necessary constants from the imported CONSTANTS object.
const { languages, paths } = CONSTANTS

// Define the type of props for the Layout component.
type LayoutProps = {
  main: ReactNode
}
// Define the Layout component.
const Layout: FC<LayoutProps> = ({ main }) => {
  // Define an initial width for the sidebar.
  const INITIAL_SIDEBAR_WIDTH = 384
  // Get the translation function from the i18next library.
  const { t } = useTranslation('navigation')
  // Use the useProject hook to get project-related information.
  const { projectXmlAsObj } = useStore(projectStore)
  // Get the current pathname from the location.
  const { pathname } = useLocation()
  // Use the useSidebar hook to manage sidebar state.
  const { current, navigate } = useSidebar()
  // Use the useToggle hook to manage the sidebar open/close state.
  const [isSidebarOpen, toggleIsSideBarOpen] = useToggle(true)
  // State to manage the width of the resizable sidebar.
  const [sidebarWidth, setSidebarWidth] = useState(INITIAL_SIDEBAR_WIDTH)

  // Handle clicking on navigation items and updating the sidebar state.
  const handleClick = (key?: CurrentProps) => {
    if (!isSidebarOpen) toggleIsSideBarOpen()
    if (key) navigate(key)
  }

  // Define an array of navigation items with their associated data.
  const navigation = [
    {
      key: 'tools',
      name: t('tools'),
      onClick: handleClick,
      icon: HiOutlineSquares2X2,
      component: <Tools />,
    },
    ...(projectXmlAsObj
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
    ...(projectXmlAsObj?.types?.pous?.pou // === languages.LD
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
    ...(projectXmlAsObj && pathname.includes(paths.POU)
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

  // Handle the sidebar resizing.
  const onResize = (data: ResizeCallbackData) =>
    setSidebarWidth(data.size.width)

  // Determine which component should be displayed in the sidebar.
  const getSidebar = () =>
    navigation.find(({ key }) => key === current)?.component
  /**
   * @returns A JSX element with the Layout component
   */
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

      <main className="h-full w-full bg-gray-100 dark:bg-gray-800">
        {/* <Tools /> */}
        {main}
      </main>
    </div>
  )
}

export default Layout
