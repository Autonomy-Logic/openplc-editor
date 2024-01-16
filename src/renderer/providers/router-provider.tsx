import { ReactNode } from 'react'
import {
	createBrowserRouter,
	RouterProvider as ReactRouterProvider,
} from 'react-router-dom'

import { StartPage } from '../pages'
import { Screen } from '~features/index'

const router = createBrowserRouter([
	{
		id: 'root',
		path: '/',
		element: <Screen.Start />,
	},
	{
		id: 'editor',
		path: 'editor',
		element: <Screen.Editor />,
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
