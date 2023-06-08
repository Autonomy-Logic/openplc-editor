import { useContext } from 'react';

import { ProjectContext } from '@/contexts';
import { ProjectContextData } from '@/contexts/Project';

const useProject = (): ProjectContextData => {
  const context = useContext(ProjectContext);
  if (!context) throw new Error('useProject must be used within a ProjectProvider');
  return context;
};

export default useProject;
