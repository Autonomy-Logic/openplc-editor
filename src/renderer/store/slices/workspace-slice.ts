/* eslint-disable no-param-reassign */
import { produce } from 'immer';
import { CreatePouDto, UpdatePouDto } from 'renderer/contracts/dtos';
import { StateCreator } from 'zustand';

import { TPou, TXmlProject } from '../../../shared/contracts/types';
import { PouSchema } from '../../../shared/contracts/validations';

export type WorkspaceProps = {
  projectPath: string | null;
  projectData: TXmlProject | null;
};

export type WorkspaceSlice = WorkspaceProps & {
  setWorkspace: (workspaceData: WorkspaceProps) => void;
  updateProject: (projectData?: TXmlProject) => void;
  updatePou: (pouData: UpdatePouDto) => void;
  addPou: (pouData: CreatePouDto) => void;
};

// TODO: Add validations
const createWorkspaceSlice: StateCreator<WorkspaceSlice, [], [], WorkspaceSlice> = (setState) => ({
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
      produce((state: WorkspaceProps) => {
        state.projectPath = workspaceData.projectPath;
        state.projectData = workspaceData.projectData;
      })
    ),
  /**
   * Updates the project data in the workspace state.
   *
   * @param {Object} projectData - The updated project data.
   * @return {void}
   */
  updateProject: (projectData?: TXmlProject): void => {
    setState(
      produce((state: WorkspaceProps) => {
        if (!projectData) return;
        state.projectData = projectData;
      })
    );
  },
  /**
   * Adds a new Pou to the state.
   *
   * @param {object} pou - The Pou object to add.
   * @param {string} pou.name - The name of the Pou.
   * @param {string} pou.type - The type of the Pou.
   * @param {string} pou.language - The language of the Pou.
   * @returns {void}
   */
  addPou: ({ name, type, language }: { name: string; type: string; language: string }): void => {
    const draftDataToAddPou: TPou = {
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
    const pouToAdd = PouSchema.parse(draftDataToAddPou);
    setState(
      produce((state: WorkspaceProps) => {
        if (!state.projectData) return;
        const pous = state.projectData.project.types.pous.pou;
        if (pous.find((p) => p['@name'] === pouToAdd['@name'])) return;
        state.projectData.project.types.pous.pou.push(pouToAdd);
      })
    );
  },
  /**
   * Updates the pou in the workspace state with the given name and body.
   * If the pou with the given name does not exist, nothing is done.
   *
   * @param {Object} options - The options object.
   * @param {string} options.name - The name of the pou to update.
   * @param {string} options.body - The new body of the pou.
   */
  updatePou: ({ name, body }: { name: string; body: string }) => {
    setState(
      produce((state: WorkspaceProps) => {
        if (!state.projectData) return;
        const pouToUpdate = state.projectData.project.types.pous.pou.find(
          (p) => p['@name'] === name
        );
        if (!pouToUpdate) return;
        if (pouToUpdate.body.IL) pouToUpdate.body.IL = { 'xhtml:p': { $: body } };
        if (pouToUpdate.body.ST) pouToUpdate.body.ST = { 'xhtml:p': { $: body } };
      })
    );
  },
});

export default createWorkspaceSlice;
