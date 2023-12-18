import { ReactNode } from 'react';
import { createBrowserRouter, RouterProvider as ReactRouterProvider } from 'react-router-dom';

import { EditorLayout, StartLayout } from '../layouts';
import { StartPage } from '../pages';

const router = createBrowserRouter([
  {
    id: 'root',
    path: '/',
    element: <StartLayout />,
    children: [
      {
        index: true,
        element: <StartPage />,
      },
    ],
  },
  {
    id: 'editor',
    path: 'editor',
    element: <EditorLayout />,
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
]);
export default function RouterProvider(): ReactNode {
  return <ReactRouterProvider router={router} />;
}
