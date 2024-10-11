import { produce } from 'immer'
import { z } from 'zod'
import { create } from 'zustand'

const formDataSchema = z.object({
  type: z.enum(['available', 'plc-project', 'plc-library']),
  name: z.string(),
  path: z.string(),
  language: z.enum(['available', 'IL', 'ST', 'LD', 'SFC', 'FBD']),
  time: z.string(),
})

const projectFormState = z.enum(['available', '1', '2', '3'])

const newProjectFormState = z.object({
  formCurrentStep: projectFormState,
  formData: formDataSchema,
})

type NewProjectFormState = z.infer<typeof newProjectFormState>

const newProjectFormActions = z.object({
  setFormCurrentStep: z.function().args(projectFormState).returns(z.void()),
  setFormData: z.function().args(formDataSchema.partial()).returns(z.void()),
})

type NewProjectFormActions = z.infer<typeof newProjectFormActions>

type NewProjectFormZStore = NewProjectFormState & {
  actions: NewProjectFormActions
}

const NewProjectFormStore = create<NewProjectFormZStore>((setState) => ({
  formCurrentStep: 'available',
  formData: {
    type: 'available',
    name: '',
    path: '',
    language: 'available',
    time: '',
  },
  actions: {
    setFormCurrentStep: (step) =>
      setState(
        produce((store: NewProjectFormZStore) => {
          store.formCurrentStep = step
        }),
      ),
    setFormData: (form) =>
      setState(
        produce(({ formData }: NewProjectFormZStore) => {
          formData && Object.assign(formData, form)
        }),
      ),
  },
}))

export { NewProjectFormStore }
export type { NewProjectFormActions, NewProjectFormState, NewProjectFormZStore }
