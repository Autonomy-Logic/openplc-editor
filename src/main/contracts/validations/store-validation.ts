import z from 'zod'

const StoreSchema = z.object({
	last_projects: z.array(z.string()),
	theme: z.string(),
	window: z.object({
		bounds: z.object({
			width: z.number(),
			height: z.number(),
			x: z.number(),
			y: z.number(),
		}),
	}),
})

export default StoreSchema
