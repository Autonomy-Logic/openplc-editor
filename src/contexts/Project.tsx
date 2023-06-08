import { CONSTANTS } from '@shared/constants';
import React, { createContext, PropsWithChildren, useCallback, useState } from 'react';
import {
  XMLSerializedAsObject,
  XMLSerializedAsObjectArray,
} from 'xmlbuilder2/lib/interfaces';

import { useIpcRender, useToast } from '@/hooks';

const {
  channels: { get },
} = CONSTANTS;

type ProjectProps = XMLSerializedAsObject | XMLSerializedAsObjectArray;

type GetProjectProps = {
  ok: boolean;
  reason?: { title: string; description?: string };
  data?: ProjectProps;
};

export type ProjectContextData = {
  project?: ProjectProps;
  getProject: (path: string) => Promise<void>;
};

export const ProjectContext = createContext<ProjectContextData>({} as ProjectContextData);

const ProjectProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [project, setProject] = useState<ProjectProps>();
  const { createToast } = useToast();
  const { invoke } = useIpcRender<string, GetProjectProps>({
    channel: get.PROJECT,
    callback: ({ ok, data, reason }) => {
      console.log('callback ->', { ok, data, reason });
      if (!ok && reason) {
        createToast({
          type: 'error',
          ...reason,
        });
      } else if (ok && data) {
        setProject(data);
      }
    },
  });

  const getProject = useCallback(
    async (path: string) => {
      const { ok, data, reason } = await invoke(get.PROJECT, path);
      if (!ok && reason) {
        createToast({
          type: 'error',
          ...reason,
        });
      } else if (ok && data) {
        setProject(data);
      }
    },
    [createToast, invoke],
  );

  return (
    <ProjectContext.Provider value={{ project, getProject }}>
      {children}
    </ProjectContext.Provider>
  );
};

export default ProjectProvider;
