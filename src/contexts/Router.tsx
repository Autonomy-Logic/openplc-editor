import { CONSTANTS } from '@shared/constants'
import { FC } from 'react'
import {
  createBrowserRouter,
  RouterProvider as ReactRouterDomRouterProvider,
} from 'react-router-dom'

import { Home, ProjectTree, Settings, Theme, Tools } from '@/pages'

const { paths } = CONSTANTS

const router = createBrowserRouter([
  {
    path: paths.HOME,
    element: <Home />,
    children: [
      {
        path: paths.TOOLS,
        element: <Tools />,
      },
      {
        path: paths.PROJECT_TREE,
        element: <ProjectTree />,
      },
      {
        path: paths.SETTINGS,
        element: <Settings />,
        children: [
          {
            path: paths.THEME,
            element: <Theme />,
          },
        ],
      },
    ],
  },
])

const RouterProvider: FC = () => {
  return <ReactRouterDomRouterProvider router={router} />
}

export default RouterProvider
