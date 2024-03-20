import { ComponentProps } from 'react'
import { VariablesTableRow } from './table-row'
import { IVariableClass, IVariableType } from '../data'

type IVariableProps = {
	id: string
	name: string
	class: IVariableClass
	type: IVariableType
	location: string
	initialValue: string
	documentation: string
	debug: boolean
}
type IVariablesTableProps = ComponentProps<'table'> & {
	data: IVariableProps[]
}
const VariablesTable = (props: IVariablesTableProps) => {
	const { data, ...res } = props
	const tableHeaderCells = [
		'#',
		'Name',
		'Class',
		'Type',
		'Location',
		'Initial value',
		'Debug',
		'Documentation',
	]
	return (
		<table id='Variable table' className='w-full flex-1' {...res}>
			<thead
				id='Variable table header container'
				className='border-b border-neutral-300 dark:border-neutral-850 '
			>
				<tr
					id='Variable table header'
					className='divide-x divide-neutral-300 dark:divide-neutral-850'
				>
					{tableHeaderCells.map((cell) => (
						<th
							key={cell}
							className='h-8 px-4 py-2 text-center text-neutral-850 font-medium text-xs dark:text-neutral-300'
						>
							{cell}
						</th>
					))}
				</tr>
			</thead>
			<tbody
				id='Variable table body'
				className='divide-y divide-x divide-neutral-300 dark:divide-neutral-850'
			>
				{data.map((row) => (
					<VariablesTableRow key={row.id} data={row} />
				))}
			</tbody>
		</table>
	)
}

export { VariablesTable }
