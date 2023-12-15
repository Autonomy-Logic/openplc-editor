/* eslint-disable no-console */
import { Outlet, useLocation } from 'react-router-dom';
import { useOpenPLCStore } from 'srcRoot/renderer/store';

// Todo: Add children and the property to exclude the data from the current workspace
export default function EditorLayout() {
  const location = useLocation();
  console.log(location.pathname);
  const projectDataDraft = useOpenPLCStore.useProjectData();
  const projectPathDraft = useOpenPLCStore.useProjectPath();
  return (
    <div>
      <h1> Editor Layout</h1>
      <h2>{`${projectDataDraft}`}</h2>
      <h2>{projectPathDraft}</h2>
      <Outlet />
    </div>
  );
}
