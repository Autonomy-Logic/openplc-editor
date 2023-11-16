import { z } from 'zod';

export const ToastSchema = z.object({
  type: z.enum(['success', 'error', 'warning', 'info']),
  title: z.string(),
  description: z.string().optional(),
});
