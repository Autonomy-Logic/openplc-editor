import {
	FBDIcon,
	FunctionBlockIcon,
	FunctionIcon,
	ILIcon,
	LDIcon,
	ProgramIcon,
	SFCIcon,
	STIcon,
} from '@root/renderer/assets'
import { ReactElement } from 'react'

const PouLanguageSources = [
	{
		icon: <LDIcon />,
		value: 'Ladder Diagram',
	},

	{
		icon: <SFCIcon />,
		value: 'Sequential Functional Chart',
	},

	{
		icon: <FBDIcon />,
		value: 'Functional Block Diagram',
	},

	{
		icon: <STIcon />,
		value: 'Structured Text',
	},
	{
		icon: <ILIcon />,
		value: 'Instruction List',
	},
]

const CreatePouSources: {
	id: number
	label: 'function' | 'function-block' | 'program'
	icon: ReactElement
}[] = [
	{
		id: 0,
		label: 'function',
		icon: <FunctionIcon size='sm' />,
	},
	{
		id: 1,
		label: 'function-block',
		icon: <FunctionBlockIcon size='sm' />,
	},
	{
		id: 2,
		label: 'program',
		icon: <ProgramIcon size='sm' />,
	},
]

export { PouLanguageSources, CreatePouSources }
