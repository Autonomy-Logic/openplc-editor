import { StateCreator } from 'zustand'
import { produce } from 'immer'

type IPlatformState = {
	platformName: string | null
	platformType: string | null
}

type IPlatformSlice = IPlatformState & {
	setPlatFormData: (platformData: IPlatformState) => void
}

const createPlatformSlice: StateCreator<
	IPlatformState,
	[],
	[],
	IPlatformSlice
> = (setState) => ({
	platformName: null,
	platformType: null,

	setPlatFormData: (platformData: IPlatformState): void =>
		setState(
			produce((state: IPlatformState) => {
				state.platformName = platformData.platformName
				state.platformType = platformData.platformType
			})
		),
})

export { createPlatformSlice, type IPlatformSlice }
