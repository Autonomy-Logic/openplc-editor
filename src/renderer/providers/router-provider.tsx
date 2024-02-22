import { ReactNode } from 'react'
import {
	RouterProvider as ReactRouterProvider,
	createBrowserRouter,
} from 'react-router-dom'

import { Screen } from '~features/index'

const router = createBrowserRouter([
	{
		id: 'root',
		path: '/',
		element: <Screen.Workspace />,
	},
	{
		id: 'workspace',
		path: 'workspace',
		element: <Screen.Workspace />,
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
