import { produce } from 'immer';
import { create } from 'zustand';
import { ProjectDTO } from '../../types/common/project';

type PouProps = {
  type: string;
  name: string;
  language: string;
  body: string;
};

type WorkspaceProps = {
  projectPath: string | null;
  projectData: ProjectDTO | null;
};

type WorkspaceState = WorkspaceProps & {
  setWorkspace: (workspaceData: WorkspaceProps) => void;
  addPou: (pouData: PouProps) => void;
};

const WorkspaceStore = create<WorkspaceState>()((setState) => ({
  projectPath: null,
  projectData: null,
  /**
   * Sets the workspace data.
   *
   * @param {WorkspaceProps} workspaceData - The workspace data to set.
   * @return {void}
   */
  setWorkspace: (workspaceData: WorkspaceProps): void =>
    setState(
      produce((state) => {
        state.projectPath = workspaceData.projectPath;
        state.projectData = workspaceData.projectData;
      }),
    ),
  // Refactor: Doesn't fit the project structure
  addPou: (pouData: PouProps): void => {
    setState(
      produce((state) => {
        state.projectData.project.types.pous[pouData.name] = {
          type: pouData.type,
          name: pouData.name,
          language: pouData.language,
          body: pouData.body,
        };
      }),
    );
  },
}));

export default WorkspaceStore;
