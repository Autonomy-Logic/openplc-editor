import { produce } from 'immer';
import { StateCreator } from 'zustand';
import { ProjectDTO } from '@/types/common/project';

export type WorkspaceProps = {
  projectPath: string | null;
  projectData: ProjectDTO | null;
};

export type WorkspaceSlice = WorkspaceProps & {
  setWorkspace: (workspaceData: WorkspaceProps) => void;
  updateProject: (projectData?: ProjectDTO) => void;
  updatePou: (pouToUpdate: string, pouData: string) => void;
};

const createWorkspaceSlice: StateCreator<
  WorkspaceSlice,
  [],
  [],
  WorkspaceSlice
> = (setState) => ({
  projectData: null,
  projectPath: null,

  setWorkspace: (workspaceData: WorkspaceProps): void =>
    setState(
      produce((state: WorkspaceProps) => {
        state.projectPath = workspaceData.projectPath;
        state.projectData = workspaceData.projectData;
      }),
    ),
  updateProject: (projectData) => {
    setState(
      produce((state: WorkspaceProps) => {
        if (!projectData) return;
        state.projectData = projectData;
      }),
    );
  },
  updatePou: (pouToUpdate, pouData) => {
    setState(
      produce((state: WorkspaceProps) => {
        if (state.projectData) {
          const pou = state.projectData.project.types.pous.pou.find(
            (p) => p['@name'] === pouToUpdate,
          );
          if (pou?.body.IL) {
            pou.body.IL['xhtml:p'].$ = pouData;
          } else if (pou?.body.ST) {
            pou.body.ST['xhtml:p'].$ = pouData;
          }
        }
      }),
    );
  },
});

export default createWorkspaceSlice;
