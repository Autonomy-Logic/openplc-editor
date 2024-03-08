import { StateCreator } from 'zustand'
import { produce } from 'immer'

type IPlatformState = {
	OS: 'win32' | 'linux' | 'darwin' | ''
	arch: 'x64' | 'arm' | ''
}

type IPlatformActions = {
	setPlatFormData: (platformData: IPlatformState) => void
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
	setPlatFormData: (platformData: IPlatformState): void =>
		setState(
			produce((state: IPlatformState) => {
				state.OS = platformData.OS
				state.arch = platformData.arch
			})
		),
})
