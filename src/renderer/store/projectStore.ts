import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { LadderProgram, Project } from '../types/project';
import { generateId } from '../utils/idGenerator';

interface ProjectState {
  project: Project | null;
  setProject: (project: Project) => void;
  addLadderProgram: (program: Omit<LadderProgram, 'id'>) => void;
  updateLadderProgram: (id: string, program: Partial<LadderProgram>) => void;
  deleteLadderProgram: (id: string) => void;
  duplicateLadderProgram: (id: string) => void;
  reset: () => void;
}

const defaultProject: Project = {
  id: '',
  name: 'Untitled Project',
  ladderPrograms: [],
  settings: {
    plcType: 'generic',
    cycleTime: 100,
  },
};

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      project: defaultProject,
      setProject: (project) => set({ project }),
      addLadderProgram: (program) =>
        set((state) => ({
          project: {
            ...state.project!,
            ladderPrograms: [
              ...state.project!.ladderPrograms,
              { ...program, id: generateId() },
            ],
          },
        })),
      updateLadderProgram: (id, updates) =>
        set((state) => ({
          project: {
            ...state.project!,
            ladderPrograms: state.project!.ladderPrograms.map((program) =>
              program.id === id ? { ...program, ...updates } : program
            ),
          },
        })),
      deleteLadderProgram: (id) =>
        set((state) => ({
          project: {
            ...state.project!,
            ladderPrograms: state.project!.ladderPrograms.filter(
              (program) => program.id !== id
            ),
          },
        })),
      duplicateLadderProgram: (id) =>
        set((state) => {
          const programToDuplicate = state.project!.ladderPrograms.find(
            (program) => program.id === id
          );
          if (!programToDuplicate) return state;

          const duplicatedProgram: LadderProgram = {
            ...programToDuplicate,
            id: generateId(),
            name: `${programToDuplicate.name} Copy`,
          };

          return {
            project: {
              ...state.project!,
              ladderPrograms: [...state.project!.ladderPrograms, duplicatedProgram],
            },
          };
        }),
      reset: () => set({ project: defaultProject }),
    }),
    {
      name: 'openplc-editor-project',
    }
  )
);