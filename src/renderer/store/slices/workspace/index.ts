import { produce } from 'immer';
import { StateCreator } from 'zustand';
import { ProjectDTO } from '@/types/common/project';
import { PouShape } from '../../../../types/common/pou';

export type WorkspaceProps = {
  projectPath: string | null;
  projectData: ProjectDTO | null;
};

export type WorkspaceSlice = WorkspaceProps & {
  setWorkspace: (workspaceData: WorkspaceProps) => void;
  getPous: () => PouShape[];
};

const createWorkspaceSlice: StateCreator<
  WorkspaceSlice,
  [],
  [],
  WorkspaceSlice
> = (setState, getState) => ({
  projectData: null,
  projectPath: null,
  setWorkspace: (workspaceData: WorkspaceProps): void =>
    setState(
      produce((state: WorkspaceProps) => {
        state.projectPath = workspaceData.projectPath;
        state.projectData = workspaceData.projectData;
      }),
    ),
  getPous: (): PouShape[] => {
    const state = getState();
    if (!state.projectData) {
      return [];
    }
    return state.projectData.project.types.pous.pou;
  },
});

export default createWorkspaceSlice;
