import {
	IFunction,
	IFunctionBlock,
	IProgram,
	type IProject,
} from '@root/types/PLC/index'
import { produce } from 'immer'
import { StateCreator } from 'zustand'

type IPouDTO =
	| {
			type: 'program'
			data: IProgram
	  }
	| {
			type: 'function'
			data: IFunction
	  }
	| {
			type: 'functionBlock'
			data: IFunctionBlock
	  }

type IProjectState = {
	projectName: string
	projectPath: string
	systemConfigs: {
		OS: 'win32' | 'linux' | 'darwin' | ''
		arch: 'x64' | 'arm' | ''
		shouldUseDarkMode: boolean
	}
	projectData: IProject
	createdAt: string
	updatedAt: string
}

type IProjectActions = {
	setUserWorkspace: (initialState: IProjectState) => void
	setSystemConfigs: (systemConfigs: IProjectState['systemConfigs']) => void
	switchAppTheme: () => void
	updateProjectName: (projectName: string) => void
	updateProjectPath: (projectPath: string) => void
	createPou: (pouToBeCreated: IPouDTO) => void
	updatePou: (dataToBeUpdated: Pick<IPouDTO, 'data'>) => void
	deletePou: (pouToBeDeleted: string) => void
}

type IProjectSlice = {
	state: IProjectState
	actions: IProjectActions
}

const createProjectSlice: StateCreator<IProjectSlice, [], [], IProjectSlice> = (
	setState
) => ({
	state: {
		projectName: '',
		projectPath: '',
		systemConfigs: {
			OS: '',
			arch: '',
			shouldUseDarkMode: false,
		},
		projectData: {
			dataTypes: [],
			pous: [],
			variables: [],
		},
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	},
	actions: {
		setUserWorkspace: (initialState: IProjectState): void => {
			setState(
				produce((slice: IProjectSlice) => {
					slice.state = initialState
				})
			)
		},
		setSystemConfigs: (systemConfigs: IProjectState['systemConfigs']): void => {
			setState(
				produce((slice: IProjectSlice) => {
					slice.state.systemConfigs = systemConfigs
				})
			)
		},
		switchAppTheme: (): void => {
			setState(
				produce((slice: IProjectSlice) => {
					slice.state.systemConfigs.shouldUseDarkMode =
						!slice.state.systemConfigs.shouldUseDarkMode
				})
			)
		},
		updateProjectName: (projectName: string): void => {
			setState(
				produce((slice: IProjectSlice) => {
					slice.state.projectName = projectName
				})
			)
		},
		updateProjectPath: (projectPath: string): void => {
			setState(
				produce((slice: IProjectSlice) => {
					slice.state.projectPath = projectPath
				})
			)
		},
		createPou: (pouToBeCreated: IPouDTO): void => {
			setState(
				produce((slice: IProjectSlice) => {
					slice.state.projectData.pous.push(pouToBeCreated)
				})
			)
		},
		updatePou: (dataToBeUpdated: Pick<IPouDTO, 'data'>): void => {
			setState(
				produce((slice: IProjectSlice) => {
					const draft = slice.state.projectData.pous.find((pou) => {
						return pou.data.name === dataToBeUpdated.data.name
					})
					if (draft) draft.data = dataToBeUpdated.data
				})
			)
		},
		deletePou: (pouToBeDeleted: string): void => {
			setState(
				produce((slice: IProjectSlice) => {
					slice.state.projectData.pous = slice.state.projectData.pous.filter(
						(pou) => pou.data.name !== pouToBeDeleted
					)
				})
			)
		},
	},
})

export { createProjectSlice, type IProjectSlice }
