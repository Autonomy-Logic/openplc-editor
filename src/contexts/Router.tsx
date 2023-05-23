import { CONSTANTS } from '@shared/constants';
import React from 'react';
import {
  createBrowserRouter,
  RouterProvider as ReactRouterDomRouterProvider,
} from 'react-router-dom';

import { CreatePOU, Home } from '@/pages';

const { paths } = CONSTANTS;

const router = createBrowserRouter([
  {
    path: '/',
    element: <Home />,
  },
  {
    path: paths.CREATE_POU,
    element: <CreatePOU />,
  },
]);

const RouterProvider: React.FC = () => {
  return <ReactRouterDomRouterProvider router={router} />;
};

export default RouterProvider;
