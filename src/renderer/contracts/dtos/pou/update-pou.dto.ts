import { z } from 'zod';

const updatePouDtoSchema = z.object({
  name: z.string().min(1, { message: 'Name is required' }),
  body: z.string().min(1, { message: 'Body is required' }),
});

export type UpdatePouDto = z.infer<typeof updatePouDtoSchema>;
