/** Deprecated - Must be removed */
import { z } from 'zod'
import { StateCreator, create } from 'zustand'
import { produce } from 'immer'

/**
 * Define the schema for a POU unit in the Pous state.
 */
const pouSchema = z.object({
	'@name': z.string(),
	'@pouType': z.enum(['program', 'function']),
	'@language': z.string(),
	interface: z.object({
		returnType: z.enum(['BOOL', 'INT', 'DINT']),
		localVars: z
			.object({
				variables: z.array(
					z.object({
						'@name': z.string(),
						type: z.enum(['BOOL', 'INT', 'DINT']),
						initialValue: z.any(),
					})
				),
			})
			.optional(),
	}),
	body: z.object({
		IL: z
			.object({
				'xhtml:p': z.string(),
			})
			.optional(),
		ST: z
			.object({
				'xhtml:p': z.string(),
			})
			.optional(),
	}),
	documentation: z
		.object({
			'xhtml:p': z.string(),
		})
		.optional(),
})

/**
 * Create a type for a POU unit.
 */
type IPou = z.infer<typeof pouSchema>

/**
 * Define the schema for the Pous state.
 */
type IPousState = {
	pous: IPou[]
}
/**
 * Define the schema for the Pous slice, which is the state and actions for the Pous.
 */
type IPousActions = {
	addPou: (pou: IPou) => void
	updatePou: (pou: Partial<IPou>) => void
	removePou: (pou: IPou) => void
}

export type IPousSlice = IPousState & IPousActions

/**
 * Create the Pous slice.
 */
export const createPousSlice: StateCreator<IPousSlice, [], [], IPousSlice> = (
	setState
) => ({
	pous: [
		{
			'@name': 'default',
			'@pouType': 'program',
			'@language': 'ST',
			interface: { returnType: 'BOOL', localVars: { variables: [] } },
			body: { ST: { 'xhtml:p': '' } },
			documentation: { 'xhtml:p': 'This is the default POU program' },
		},
		{
			'@name': 'default1',
			'@pouType': 'function',
			'@language': 'IL',
			interface: { returnType: 'BOOL', localVars: { variables: [] } },
			body: { IL: { 'xhtml:p': '' } },
			documentation: { 'xhtml:p': 'This is the default POU function' },
		},
	],
	addPou: (pou) =>
		setState(
			produce((state: IPousSlice) => {
				const pouExists = state.pous.find((p) => p['@name'] === pou['@name'])
				if (pouExists) return
				state.pous.push(pou)
			})
		),
	updatePou: (pou) =>
		setState(
			produce((state: IPousSlice) => {
				const pouToUpdate = state.pous.find((p) => p['@name'] === pou['@name'])
				if (!pouToUpdate) return
				const idx = state.pous.indexOf(pouToUpdate)
				state.pous[idx] = { ...state.pous[idx], ...pou }
			})
		),
	removePou: (pou) =>
		setState(
			produce((state: IPousSlice) => {
				const pouToRemove = state.pous.find((p) => p['@name'] === pou['@name'])
				if (!pouToRemove) return
				const idx = state.pous.indexOf(pouToRemove)
				state.pous.splice(idx, 1)
			})
		),
})
