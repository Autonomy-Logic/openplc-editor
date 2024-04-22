import { AppLayout } from '@components/_templates'
import { Screen } from '@features/index'
import { ReactNode } from 'react'
import { createBrowserRouter,RouterProvider as ReactRouterProvider } from 'react-router-dom'

import { StartScreen, WorkspaceScreen } from '../screens'
import { Test } from '../screens/test'

const router = createBrowserRouter([
  {
    id: 'root',
    path: '/',
    element: <AppLayout />,
    children: [
      {
        index: true,
        element: <StartScreen />,
      },
      {
        id: 'workspace',
        path: 'workspace',
        element: <WorkspaceScreen />,
      },
    ],
  },
  {
    /**
     * TODO: Fill the children array with the correct elements
     *
     * children: [
     *  {
     *    path: 'project'
     *    element: <Project />
     *  },
     *  {
     *    path: `:${pouName}`
     *    element: Should provide a proper name
     *  },
     *  {
     *    path: 'resources'
     *    element: <Resources />
     *  }
     * ]
     */
  },
])
export default function RouterProvider(): ReactNode {
  return <ReactRouterProvider router={router} />
}
