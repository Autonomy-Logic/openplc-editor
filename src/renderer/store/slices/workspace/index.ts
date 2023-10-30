import { produce } from 'immer';
import { StateCreator } from 'zustand';
import { ProjectDTO } from '../../../../types/common/project';
import { PouShape } from '../../../../types/common/pou';

export type WorkspaceProps = {
  projectPath: string | null;
  projectData: ProjectDTO | null;
};

export type WorkspaceSlice = WorkspaceProps & {
  setWorkspace: (workspaceData: WorkspaceProps) => void;
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
      produce((state) => {
        state.projectPath = workspaceData.projectPath;
        state.projectData = workspaceData.projectData;
      }),
    ),
  addPou: (pou: PouShape): void => {
    setState(
      produce((state) => {
        state.projectData.project.types.pous.pou['@name'] = pou;
      }),
    );
  },
});

export default createWorkspaceSlice;
