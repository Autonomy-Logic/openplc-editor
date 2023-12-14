import { RouteObject } from 'react-router-dom';
import { CONSTANTS } from 'srcRoot/shared/data';

import { Editor, Main, Project, Resources } from '../pages';

const { paths } = CONSTANTS;
const editorRoutes: RouteObject[] = [
  {
    path: '/',
    element: <Main />,
    children: [
      {
        path: paths.PROJECT,
        element: <Project />,
      },
      {
        path: `${paths.EDITOR}/:pouName`,
        element: <Editor />,
      },
      {
        path: 'resources',
        element: <Resources />,
      },
    ],
  },
];

export default editorRoutes;
