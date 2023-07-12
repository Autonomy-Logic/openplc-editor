import { CONSTANTS } from '@shared/constants'
import { FC } from 'react'
import {
  createBrowserRouter,
  RouterProvider as ReactRouterDomRouterProvider,
} from 'react-router-dom'

import { Main, Pou, Project, Res } from '@/pages'

const { paths } = CONSTANTS

const router = createBrowserRouter([
  {
    path: paths.MAIN,
    element: <Main />,
    children: [
      {
        path: paths.PROJECT,
        element: <Project />,
      },
      {
        path: `${paths.POU}/:pouName`,
        element: <Pou />,
      },
      {
        path: paths.RES,
        element: <Res />,
      },
    ],
  },
])

const RouterProvider: FC = () => {
  return <ReactRouterDomRouterProvider router={router} />
}

export default RouterProvider
