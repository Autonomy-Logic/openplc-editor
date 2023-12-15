import { ReactNode, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { TXmlProject } from 'srcRoot/shared/contracts/types';

import useOpenPLCStore from '../store';

export default function StartPage(): ReactNode {
  const projectDataDraft = useOpenPLCStore.useProjectData();
  const projectPathDraft = useOpenPLCStore.useProjectPath();
  const handleSetWorkSpace = useOpenPLCStore.useSetWorkspace();
  const navigate = useNavigate();

  const getData = useCallback(() => {
    window.bridge.createProject((_event, { data }) => {
      const projectPath = data?.path as unknown as string;
      const projectData = data?.xmlAsObject as unknown as TXmlProject;
      handleSetWorkSpace({ projectPath, projectData });
      // eslint-disable-next-line no-console
      console.warn('Trigger');
      navigate('main')
    });

    window.bridge.openProject((_event, { data }) => {
      const projectPath = data?.path as unknown as string;
      const projectData = data?.xmlAsObject as unknown as TXmlProject;
      handleSetWorkSpace({ projectPath, projectData });
    });
  }, [handleSetWorkSpace]);

  useEffect(() => {
    getData();
  }, [getData]);

  return (
    <>
      <h1>{`Current project path: ${projectPathDraft}`}</h1>
      <div>
        <h2> {`This must be the current data: ${projectDataDraft}`}</h2>
      </div>
    </>
  );
}
