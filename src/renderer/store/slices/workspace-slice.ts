import { StateCreator } from 'zustand'
import { produce } from 'immer'
import { z } from 'zod'
import { IProjectData } from '@root/types/transfer'

type IWorkspaceState = {
	path: string
	projectName: string
	data: IProjectData | null
	createdAt: string
	updatedAt: string
}

type IWorkspaceActions = {
	setWorkspace: (workspaceData: IWorkspaceState) => void
	updateWorkspace: (workspaceData: IWorkspaceState) => void
	clearWorkspace: () => void
}

export type IWorkspaceSlice = IWorkspaceState & IWorkspaceActions
/**
 * Define the schema for a POU unit in the Pous state.
 */
const pouSchema = z.object({
	'@name': z.string(),
	'@pouType': z.enum(['program', 'function']),
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

export const createWorkspaceSlice: StateCreator<
	IWorkspaceSlice,
	[],
	[],
	IWorkspaceSlice
> = (setState) => ({
	path: 'C://User//File//file.json',
	projectName: 'default-project',
	data: null,
	createdAt: '0000-00-00T00:00:00.000Z',
	updatedAt: '0000-00-00T00:00:00.000Z',
	setWorkspace: (workspaceData: IWorkspaceState) => {
		setState(
			produce((state: IWorkspaceSlice) => {
				state.path = workspaceData.path
				state.projectName = workspaceData.projectName
				state.data = workspaceData.data
				state.createdAt = workspaceData.createdAt
				state.updatedAt = workspaceData.updatedAt
			})
		)
	},
	updateWorkspace: (workspaceData: IWorkspaceState) => {
		setState(
			produce((state: IWorkspaceSlice) => {
				state.projectName = workspaceData.projectName
				state.data = workspaceData.data
				state.updatedAt = workspaceData.updatedAt
			})
		)
	},
	clearWorkspace: () => {
		setState(
			produce((state: IWorkspaceSlice) => {
				state.path = 'C://User//File//file.json'
				state.projectName = 'default-project'
				state.data = null
				state.createdAt = '0000-00-00T00:00:00.000Z'
				state.updatedAt = '0000-00-00T00:00:00.000Z'
			})
		)
	},
})

// 	 * Adds a new Pou to the state.
// 	 *
// 	 * @param {object} pou - The Pou object to add.
// 	 * @param {string} pou.name - The name of the Pou.
// 	 * @param {string} pou.type - The type of the Pou.
// 	 * @param {string} pou.language - The language of the Pou.
// 	 * @returns {void}
// 	 */
// 	addPou: ({
// 		name,
// 		type,
// 		language,
// 	}: { name: string; type: string; language: string }): void => {
// 		const draftDataToAddPou: TPou = {
// 			'@name': name,
// 			'@pouType': type,
// 			body: {
// 				[language]: {
// 					'xhtml:p': {
// 						$: '',
// 					},
// 				},
// 			},
// 		}
// 		const pouToAdd = PouSchema.parse(draftDataToAddPou)
// 		setState(
// 			produce((state: WorkspaceProps) => {
// 				if (!state.projectData) return
// 				const pous = state.projectData.project.types.pous.pou
// 				if (pous.find((p) => p['@name'] === pouToAdd['@name'])) return
// 				state.projectData.project.types.pous.pou.push(pouToAdd)
// 			})
// 		)
// 	},
// 	/**
// 	 * Updates the pou in the workspace state with the given name and body.
// 	 * If the pou with the given name does not exist, nothing is done.
// 	 *
// 	 * @param {Object} options - The options object.
// 	 * @param {string} options.name - The name of the pou to update.
// 	 * @param {string} options.body - The new body of the pou.
// 	 */
// 	updatePou: ({ name, body }: { name: string; body: string }) => {
// 		setState(
// 			produce((state: WorkspaceProps) => {
// 				if (!state.projectData) return
// 				const pouToUpdate = state.projectData.project.types.pous.pou.find(
// 					(p) => p['@name'] === name
// 				)
// 				if (!pouToUpdate) return
// 				if (pouToUpdate.body.IL)
// 					pouToUpdate.body.IL = { 'xhtml:p': { $: body } }
// 				if (pouToUpdate.body.ST)
// 					pouToUpdate.body.ST = { 'xhtml:p': { $: body } }
// 			})
// 		)
// 	},
// })
