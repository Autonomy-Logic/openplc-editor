/* eslint-disable no-console */
import { ReactNode } from 'react';
import useOpenPLCStore from '../store';

function Editor(): ReactNode {
  const project = useOpenPLCStore.useProjectData();

  return <p>{project ? project.toString() : 'Null'}</p>;
}

export default Editor;
