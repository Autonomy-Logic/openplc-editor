import { z } from 'zod'

const programSchema = z.object({
	language: z.enum(['IL', 'ST', 'LD', 'SFC', 'FBD']).default('IL'),
	name: z.string(),
	/** Array of variable - will be implemented */
	variables: z.array(z.string()).optional(),
	body: z.string().optional(),
	documentation: z.string().optional(),
})

type IProgram = z.infer<typeof programSchema>

export { programSchema, IProgram }
