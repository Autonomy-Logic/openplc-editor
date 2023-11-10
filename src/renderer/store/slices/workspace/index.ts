import { produce } from 'immer';
import { StateCreator } from 'zustand';
import { ProjectDTO } from '@/types/common/project';
import { CreatePouDto, UpdatePouDto } from '@/renderer/contracts/dtos';

export type WorkspaceProps = {
  projectPath: string | null;
  projectData: ProjectDTO | null;
};

export type WorkspaceSlice = WorkspaceProps & {
  setWorkspace: (workspaceData: WorkspaceProps) => void;
  updateProject: (projectData?: ProjectDTO) => void;
  updatePou: (pouData: UpdatePouDto) => void;
  addPou: (pouData: CreatePouDto) => void;
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
  updatePou: ({ name, body }) => {
    setState(
      produce((state: WorkspaceProps) => {
        if (!state.projectData) return state;
        const pouToUpdate = state.projectData.project.types.pous.pou.find(
          (p) => p['@name'] === name,
        );
        if (!pouToUpdate) return state;
        if (pouToUpdate.body.IL)
          pouToUpdate.body.IL = { 'xhtml:p': { $: body } };
        if (pouToUpdate.body.ST)
          pouToUpdate.body.ST = { 'xhtml:p': { $: body } };
      }),
    );
  },
  addPou: ({ name, type, language }) => {
    const pouDraft = {
      '@name': name,
      '@pouType': type,
      body: {
        [language]: {
          'xhtml:p': {
            $: '',
          },
        },
      },
    };
    setState(
      produce((state: WorkspaceProps) => {
        if (!state.projectData) return state;
        const pous = state.projectData.project.types.pous;
        if (pous.pou.find((p) => p['@name'] === pouDraft['@name']))
          return state;
        pous.pou.push(pouDraft);
      }),
    );
  },
});

export default createWorkspaceSlice;
