import { z } from 'zod'
import { dataTypeSchema } from './units/data-type'
import { programSchema } from './units/program'
import { functionSchema } from './units/function'
import { functionBlockSchema } from './units/function-block'

const projectSchema = z.object({
	dataTypes: z.array(z.lazy(() => dataTypeSchema)),
	pous: z.array(
		z.discriminatedUnion('type', [
			z.object({
				type: z.literal('program'),
				data: z.lazy(() => programSchema),
			}),
			z.object({
				type: z.literal('function'),
				data: z.lazy(() => functionSchema),
			}),
			z.object({
				type: z.literal('function-block'),
				data: z.lazy(() => functionBlockSchema),
			}),
		])
	),
	globalVariables: z.array(z.string()).optional(),
})

type IProject = z.infer<typeof projectSchema>

export { projectSchema, IProject }
