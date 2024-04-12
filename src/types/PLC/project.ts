import { z } from 'zod'
import { dataTypeSchema } from './units/dataType'
import { programSchema } from './units/program'
import { functionSchema } from './units/function'
import { functionBlockSchema } from './units/functionBlock'

const projectSchema = z.object({
	dataTypes: z.array(z.lazy(() => dataTypeSchema)),
	pous: z.array(
		z.discriminatedUnion('type', [
			z.object({
				type: z.literal('program'),
				content: z.lazy(() => programSchema),
			}),
			z.object({
				type: z.literal('function'),
				content: z.lazy(() => functionSchema),
			}),
			z.object({
				type: z.literal('functionBlock'),
				content: z.lazy(() => functionBlockSchema),
			}),
		])
	),
})

type IProject = z.infer<typeof projectSchema>

export { projectSchema, IProject }
