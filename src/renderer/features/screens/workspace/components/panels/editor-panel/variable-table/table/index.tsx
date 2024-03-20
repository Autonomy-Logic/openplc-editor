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
	debug: string
	documentation: string
	test: string
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
		'Location',
		'Initial value',
		'Debug',
		'Documentation',
	]

	return (
		<div className='w-full min-w-28 pb-2 pr-2 overflow-auto oplc-scrollbar'>
			<div
				id='Variable table container'
				className='w-full min-w-max flex flex-1 rounded-lg border border-neutral-300 dark:border-neutral-850'
			>
				<table id='Variable table' className='w-full flex-1'>
					<thead
						id='Variable table header container'
						className='border-b border-neutral-300 dark:border-neutral-850 '
					>
						<tr
							id='Variable table header'
							className='divide-x divide-neutral-300 dark:divide-neutral-850'
						>
							{tableTitle.map((title) => (
								<TableHeader key={title} title={title} />
							))}
						</tr>
					</thead>
					<tbody
						id='Variable table body'
						className='divide-y divide-x divide-neutral-300 dark:divide-neutral-850'
					>
						{tableData.map((row) => (
							<TableRow key={row.id} row={row} />
						))}
					</tbody>
				</table>
			</div>
		</div>
	)
}

export default TableRoot
