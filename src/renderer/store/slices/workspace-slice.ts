import { StateCreator } from 'zustand'
import { produce } from 'immer'
import { IProjectData } from '@root/types/transfer'

/**
 * workspaceState: {
		projectName: string
		projectPath: string
		systemConfigs: {
			OS: 'win32' | 'linux' | 'darwin' | ''
			arch: 'x64' | 'arm' | ''
			shouldUseDarkMode: boolean
		}
		projectData: Partial<IProject>
		createdAt: date
		updatedAt: date
	}

	actions: {
		setInitialState: (initialState: Partial<workspaceState>) => void
		setSystemConfigs: (systemConfigs: workspaceState['systemConfigs']) => void
		toggleDarkMode: () => void
		updateProjectName: (projectName: string) => void
		updateProjectPath: (projectPath: string) => void
		addPou: (pou: IPou) => void
		updatePou: (pou: IPou) => void
		removePou: (pou: IPou) => void
	}
 */

type IWorkspaceState = {
	path: string
	projectName: string
	data: Partial<IProjectData>
	createdAt: string
	updatedAt: string
}

type IWorkspaceActions = {
	setWorkspace: (workspaceData: IWorkspaceState) => void
	updateWorkspace: (workspaceData: IWorkspaceState) => void
	clearWorkspace: () => void
}

export type IWorkspaceSlice = IWorkspaceState & IWorkspaceActions

export const createWorkspaceSlice: StateCreator<
	IWorkspaceSlice,
	[],
	[],
	IWorkspaceSlice
> = (setState) => ({
	path: 'C://User//File//file.json',
	projectName: 'default-project',
	data: {
		pous: [],
		dataTypes: [],
		variables: [],
	},
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
				state.data = {
					pous: [],
					dataTypes: [],
					variables: [],
				}
				state.createdAt = '0000-00-00T00:00:00.000Z'
				state.updatedAt = '0000-00-00T00:00:00.000Z'
			})
		)
	},
})
