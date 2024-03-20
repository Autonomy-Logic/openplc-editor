import { cn } from '@root/utils'
import TableHeader from './elements/header'
import TableRow from './elements/rows'

type IRowData = {
	id: number
	name: string
	class: string
	type: string
	localization: string
	initialValue: string
	option: string
	debug: string
	documentation: string
}

type ITableComponentProps = {
	tableData: IRowData[]
}

const TableRoot = ({ tableData }: ITableComponentProps) => {
	const tableTitle = [
		'#',
		'Name',
		'Class',
		'Type',
		'Localization',
		'Initial value',
		'Option',
		'Debug',
		'Documentation',
	]

	return (
		<div className='pb-2 pr-2 overflow-auto oplc-scrollbar'>
			<table id='Variable table' className='w-full flex-1'>
				<div
					id='Variable table container'
					className='rounded-lg border border-neutral-300 dark:border-neutral-850'
				>
					<thead
						id='Variable table header'
						className='divide-x border-b border-neutral-300 dark:border-neutral-850 divide-neutral-300 dark:divide-neutral-850'
					>
						{tableTitle.map((title) => (
							<TableHeader key={title} title={title} />
						))}
					</thead>
					<tbody
						id='Variable table body'
						className='divide-y divide-x divide-neutral-300 dark:divide-neutral-850'
					>
						{tableData.map((row) => (
							<TableRow key={row.id} row={row} />
						))}
					</tbody>
				</div>
			</table>
		</div>
	)
}

export default TableRoot
