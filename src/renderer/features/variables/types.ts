import { classesForVariables, typesForVariables } from './data'

export type IVariableProps = {
	id: number
	name: string
	class: IVariableClass
	type: IVariableType
	location: string
	initialValue: string
	documentation: string
	debug: boolean
}

export type IVariableType = keyof typeof typesForVariables
export type IVariableClass = keyof typeof classesForVariables
