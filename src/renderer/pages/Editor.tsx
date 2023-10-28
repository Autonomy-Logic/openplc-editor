/* eslint-disable no-console */
import { ReactNode } from 'react';
import useOpenPLCStore from '../store';

function Editor(): ReactNode {
  const project = useOpenPLCStore.useProjectData();
  const path = useOpenPLCStore.useProjectPath();

  console.log(project);
  console.log(path);

  return <p>Test</p>;
}

export default Editor;
