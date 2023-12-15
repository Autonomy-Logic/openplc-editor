import { RouteObject } from 'react-router-dom';

import { StartPage } from '../pages';

const startRoute: RouteObject[] = [
  {
    path: '/',
    element: <StartPage />,
  },
];

export default startRoute;
