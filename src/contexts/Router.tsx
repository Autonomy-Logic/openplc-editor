import { CONSTANTS } from '@shared/constants'
import { FC } from 'react'
import {
  createBrowserRouter,
  RouterProvider as ReactRouterDomRouterProvider,
} from 'react-router-dom'

import { Main, Pou, Project, Res } from '@/pages'
/**
 * Destructure necessary property from the CONSTANTS module.
 */
const { paths } = CONSTANTS
/**
 * Create a router configuration using createBrowserRouter.
 */
const router = createBrowserRouter([
  {
    /**
     * Configure the main path.
     */
    path: paths.MAIN,
    /**
     * Specify the Main component to render at the main path.
     */
    element: <Main />,
    children: [
      {
        /**
         * Configure the project path.
         */
        path: paths.PROJECT,
        /**
         * Specify the Project component to render at the project path.
         */
        element: <Project />,
      },
      {
        /**
         * Configure the POU path with a parameter pouName.
         */
        path: `${paths.POU}/:pouName`,
        /**
         * Specify the Pou component to render for a specific POU.
         */
        element: <Pou />,
      },
      {
        /**
         * Configure the resource path.
         */
        path: paths.RES,
        /**
         * Specify the Res component to render at the resource path.
         */
        element: <Res />,
      },
    ],
  },
])
/**
 * Define a React component that provides the configured router.
 * @returns A JSX Component with the router context provider
 */
const RouterProvider: FC = () => {
  return <ReactRouterDomRouterProvider router={router} />
}

export default RouterProvider
