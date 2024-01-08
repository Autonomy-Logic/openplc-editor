import { z } from 'zod'

export const toastSchema = z.object({
	type: z.enum(['success', 'error', 'warning', 'info']),
	title: z.string(),
	description: z.string().optional(),
})

export type ToastProps = z.infer<typeof toastSchema>
