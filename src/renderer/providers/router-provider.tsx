import { ReactNode, useCallback } from 'react';
import { createBrowserRouter, RouterProvider as ReactRouterProvider } from 'react-router-dom';

import { editorRoutes, startRoute } from '../routes';
import useOpenPLCStore from '../store';

export default function RouterProvider(): ReactNode {
  const haveProject = useOpenPLCStore.useProjectPath;
  // eslint-disable-next-line no-console
  console.log('First render => ', haveProject());

  const setRouter = useCallback(() => {
    let routerArray;
    // Refactor: update the condition that handle the render route
    if (haveProject() !== null) {
      routerArray = startRoute;
    } else {
      routerArray = editorRoutes;
    }
    const router = createBrowserRouter(routerArray);
    return router;
  }, [haveProject]);

  return <ReactRouterProvider router={setRouter()} />;
}
