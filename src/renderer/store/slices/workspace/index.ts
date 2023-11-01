import { produce } from 'immer';
import { StateCreator } from 'zustand';
import { ProjectDTO } from '@/types/common/project';

export type WorkspaceProps = {
  projectPath: string | null;
  projectData: ProjectDTO | null;
  test: { editorForProgram?: string; editorForFunction?: string };
};

export type WorkspaceSlice = WorkspaceProps & {
  setWorkspace: (workspaceData: WorkspaceProps) => void;
  updateProject: (projectData?: ProjectDTO) => void;
  setTest: (test: {
    editorForProgram?: string;
    editorForFunction?: string;
  }) => void;
};

const createWorkspaceSlice: StateCreator<
  WorkspaceSlice,
  [],
  [],
  WorkspaceSlice
> = (setState) => ({
  projectData: null,
  projectPath: null,
  test: {
    editorForProgram: 'Data for editor 1',
    editorForFunction: 'Data for editor 2',
  },
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
  setTest(test) {
    setState(
      produce((state: WorkspaceProps) => {
        if (test.editorForProgram) {
          state.test.editorForProgram = test.editorForProgram;
        }
        if (test.editorForFunction) {
          state.test.editorForFunction = test.editorForFunction;
        }
      }),
    );
  },
});

export default createWorkspaceSlice;
