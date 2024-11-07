import { produce } from 'immer';
import { create } from 'zustand';

export type NewProjectStoreProps = {
  formData: {
    type: string;
    name: string;
    path: string;
    language: string;
    time: string;
  };
  setFormData: (form: Partial<NewProjectStoreProps['formData']>) => void;
  resetFormData: () => void;
};

export const NewProjectStore = create<NewProjectStoreProps>((set) => ({
  formData: {
    type: '',
    name: '',
    path: '',
    language: '',
    time: '',
  },
  setFormData: (form: Partial<NewProjectStoreProps['formData']>) => {
    set(
      produce((state: NewProjectStoreProps) => {
        Object.assign(state.formData, form);
      })
    );
  },
  resetFormData: () => {
    set(
      produce((state: NewProjectStoreProps) => {
        state.formData = {
          type: '',
          name: '',
          path: '',
          language: '',
          time: '',
        };
      })
    );
  },
}));
