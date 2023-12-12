/* eslint-disable import/no-cycle */
import { ReactNode } from 'react';
import { createBrowserRouter, RouterProvider as ReactRouterProvider } from 'react-router-dom';
import { CONSTANTS } from 'srcRoot/shared/data';

import { Editor, Main, Project, Resources } from '../pages';
/**
 * Destructure necessary property from the CONSTANTS module.
 */
const { paths } = CONSTANTS;
/**
 * Create a router configuration using createBrowserRouter.
 */
const router = createBrowserRouter([
  {
    /**
     * Configure the main path.
     */
    path: '/',
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
        path: `${paths.EDITOR}/:pouName`,
        /**
         * Specify the Pou component to render for a specific POU.
         */
        element: <Editor />,
      },
      {
        /**
         * Configure the resource path.
         */
        path: paths.RES,
        /**
         * Specify the Res component to render at the resource path.
         */
        element: <Resources />,
      },
    ],
  },
]);
/**
 * Define a React component that provides the configured router.
 * @returns A JSX Component with the router context provider
 */
function RouterProvider(): ReactNode {
  return <ReactRouterProvider router={router} />;
}

export default RouterProvider;
