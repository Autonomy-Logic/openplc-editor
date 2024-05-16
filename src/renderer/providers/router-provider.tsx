import { AppLayout } from '@components/_templates'
import { ComponentPropsWithoutRef, ReactNode } from 'react'
import { createBrowserRouter, RouterProvider as ReactRouterProvider } from 'react-router-dom'

import { VariablesTable } from '../components/_molecules'
import { WorkspaceScreen } from '../screens'

const TestLayout = (props: ComponentPropsWithoutRef<'div'>) => {
  return <div {...props} className='align-center mx-auto flex h-full w-full justify-center' />
}

const router = createBrowserRouter([
  {
    id: 'root',
    path: '/',
    element: <AppLayout />,
    children: [
      {
        index: true,
        element: (
          <TestLayout>
            <VariablesTable />{' '}
          </TestLayout>
        ),
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
