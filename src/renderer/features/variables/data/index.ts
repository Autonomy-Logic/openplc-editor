const typesForVariables = {
	Base_Types: {
		id: 'Base Types',
		values: [
			'BOOL',
			'SINT',
			'INT',
			'DINT',
			'LINT',
			'USINT',
			'UINT',
			'UDINT',
			'ULINT',
			'REAL',
			'LREAL',
			'TIME',
			'DATE',
			'TOD',
			'DT',
			'STRING',
			'BYTE',
			'WORD',
			'DWORD',
			'LWORD',
		],
	},
	User_Data_Types: {
		id: 'User Data Types',
		values: [],
	},
	Native_Data_Types: { id: 'Native Data Types', value: ['LOGLEVEL'] },
	Array: { id: 'Array', value: [] },
}

const classesForVariables = {
	Input: 'input',
	Output: 'output',
	InOut: 'inOut',
	Local: 'local',
	Temporary: 'temporary',
}

export type IVariableType = keyof typeof typesForVariables
export type IVariableClass = keyof typeof classesForVariables

export { typesForVariables, classesForVariables }
