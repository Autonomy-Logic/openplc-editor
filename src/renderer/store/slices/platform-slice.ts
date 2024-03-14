import { StateCreator } from 'zustand'
import { produce } from 'immer'

type IPlatformState = {
	OS: 'win32' | 'linux' | 'darwin' | ''
	arch: 'x64' | 'arm' | ''
	colorScheme: 'dark' | 'light'
}

type IPlatformActions = {
	setPlatFormData: (platformData: IPlatformState) => void
	updatePlatFormData: (platformData: Partial<IPlatformState>) => void
}

export type IPlatformSlice = IPlatformState & IPlatformActions

export const createPlatformSlice: StateCreator<
	IPlatformSlice,
	[],
	[],
	IPlatformSlice
> = (setState) => ({
	OS: '',
	arch: '',
	colorScheme: 'light',
	setPlatFormData: (platformData: IPlatformState): void =>
		setState(
			produce((state: IPlatformState) => {
				state.OS = platformData.OS
				state.arch = platformData.arch
				state.colorScheme = platformData.colorScheme
			})
		),
	updatePlatFormData: (platformData: Partial<IPlatformState>): void =>
		setState(
			produce((state: IPlatformState) => {
				if (platformData.OS) state.OS = platformData.OS
				if (platformData.arch) state.arch = platformData.arch
				if (platformData.colorScheme)
					state.colorScheme = platformData.colorScheme
			})
		),
})
