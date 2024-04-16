/** Deprecated - Must be removed */
import { StateCreator } from 'zustand'
import { produce } from 'immer'

type IPlatformState = {
	OS: 'win32' | 'linux' | 'darwin' | ''
	arch: 'x64' | 'arm' | ''
	shouldUseDarkMode: boolean
}

type IPlatformActions = {
	setPlatFormData: (platformData: IPlatformState) => void
	updatePlatFormData: (platformData: Partial<IPlatformState>) => void
	updateTheme: () => void
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
	shouldUseDarkMode: false,
	setPlatFormData: (platformData: IPlatformState): void =>
		setState(
			produce((state: IPlatformState) => {
				state.OS = platformData.OS
				state.arch = platformData.arch
				state.shouldUseDarkMode = platformData.shouldUseDarkMode
			})
		),
	updatePlatFormData: (platformData: Partial<IPlatformState>): void =>
		setState(
			produce((state: IPlatformState) => {
				if (platformData.OS) state.OS = platformData.OS
				if (platformData.arch) state.arch = platformData.arch
				if (platformData.shouldUseDarkMode)
					state.shouldUseDarkMode = platformData.shouldUseDarkMode
			})
		),
	updateTheme: (): void =>
		setState(
			produce((state: IPlatformState) => {
				state.shouldUseDarkMode = !state.shouldUseDarkMode
			})
		),
})
