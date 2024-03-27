import { IProjectData } from '../../../../types/transfer'

export const ProjectDataTemplate: IProjectData = {
	pous: [
		{
			id: 0,
			name: 'PouDefault',
			type: 'program',
			languageCodification: 'Textual',
			language: 'IL',
			body: 'Pou Default Body',
			ref: '',
		},
		{
			id: 1,
			name: 'PouDefault1',
			type: 'function',
			languageCodification: 'Textual',
			language: 'ST',
			body: 'Pou Default Body 1',
			ref: '',
		},
		{
			id: 2,
			name: 'PouDefault2',
			type: 'function',
			languageCodification: 'Textual',
			language: 'ST',
			body: 'Pou Default Body 2',
			ref: '',
		},
		{
			id: 3,
			name: 'PouDefault3',
			type: 'function',
			languageCodification: 'Textual',
			language: 'ST',
			body: 'Pou Default Body 3',
			ref: '',
		},
	],
	dataTypes: [
		{
			id: 0,
			derivationType: 'Directly',
			baseType: 'INT',
			value: '',
			ref: '',
		},
		{
			id: 1,
			derivationType: 'Directly',
			baseType: 'BOOL',
			value: '',
			ref: '',
		},
	],
	variables: [],
}
