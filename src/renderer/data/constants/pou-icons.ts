import {
	DataTypeIcon,
	DeviceIcon,
	FunctionBlockIcon,
	FunctionIcon,
	ProgramIcon,
	ResourceIcon,
} from '@process:renderer/assets'

export const PouIcon = {
	function: FunctionIcon,
	'function-block': FunctionBlockIcon,
	program: ProgramIcon,
	resources: ResourceIcon,
	'data-type': DataTypeIcon,
	device: DeviceIcon,
}

export type PouIconType = typeof PouIcon
