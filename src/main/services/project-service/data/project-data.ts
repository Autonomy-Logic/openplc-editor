import { IProjectData } from '../../../../types/transfer'

export const ProjectDataTemplate: IProjectData = {
	pous: [
		{
			id: '0',
			name: 'PouDefault',
			type: 'program',
			languageCodification: 'Textual',
			language: 'IL',
			body: '',
			ref: '',
		},
		{
			id: '1',
			name: 'PouDefault1',
			type: 'function',
			languageCodification: 'Textual',
			language: 'ST',
			body: '',
			ref: '',
		},
	],
	dataTypes: [
		{
			id: '0',
			derivationType: 'Directly',
			baseType: 'INT',
			value: '',
			ref: '',
		},
		{
			id: '1',
			derivationType: 'Directly',
			baseType: 'BOOL',
			value: '',
			ref: '',
		},
	],
	variables: [],
}
