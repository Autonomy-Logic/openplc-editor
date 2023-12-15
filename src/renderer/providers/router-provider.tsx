import { ReactNode, useCallback } from 'react';
import { createBrowserRouter, RouterProvider as ReactRouterProvider } from 'react-router-dom';

import { editorRoutes, startRoute } from '../routes';
import useOpenPLCStore from '../store';

export default function RouterProvider(): ReactNode {
  const haveProject = useOpenPLCStore.useProjectData();
  const setRouter = useCallback(() => {
    if (haveProject === null) {
      return createBrowserRouter(startRoute);
    }
    return createBrowserRouter(editorRoutes);
  }, [haveProject]);

  return <ReactRouterProvider router={createBrowserRouter(editorRoutes)} />;
}
