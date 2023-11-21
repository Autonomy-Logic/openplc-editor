import { z } from 'zod';
import { CONSTANTS } from '@/utils';

const { types, languages } = CONSTANTS;
const CreatePouDtoSchema = z.object({
  name: z.string().min(1, { message: 'Name is required' }),
  type: z.string().refine((t) => Object.values(types).includes(t), {
    message: 'Invalid POU type',
  }),
  language: z.string().refine((l) => Object.values(languages).includes(l), {
    message: 'Invalid POU language',
  }),
});

export type CreatePouDto = z.infer<typeof CreatePouDtoSchema>;
