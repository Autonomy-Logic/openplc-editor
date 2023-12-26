/* eslint-disable no-console */
import { ReactNode } from 'react';

import { useOpenPLCStore } from '../store';

export default function StartPage(): ReactNode {
  const projectDataDraft = useOpenPLCStore.useProjectData();
  const projectPathDraft = useOpenPLCStore.useProjectPath();

  console.log('Trigged');
  return (
    <>
      <h1>{`Current project path: ${projectPathDraft}`}</h1>
      <div>
        <h2> {`This must be the current data: ${projectDataDraft}`}</h2>
      </div>
    </>
  );
}
