import { z } from 'zod'

const functionSchema = z.object({
	language: z.enum(['IL', 'ST', 'LD', 'SFC', 'FBD']).default('IL'),
	name: z.string(),
	returnType: z.enum(['BOOL', 'INT', 'DINT']),
	/** Array of variable - will be implemented */
	variables: z.array(z.string()).optional(),
	body: z.string().optional(),
	documentation: z.string().optional(),
})

type IFunction = z.infer<typeof functionSchema>

export { functionSchema, IFunction }
