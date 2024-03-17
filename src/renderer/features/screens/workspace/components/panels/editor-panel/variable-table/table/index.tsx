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
		<div className=' rounded-lg border border-neutral-300 overflow-auto scroll-mt-2'>
			<table className='w-full '>
				<thead className='border-b border-neutral-300'>
					<tr>
						{tableTitle.map((title) => (
							<TableHeader key={title} title={title} />
						))}
					</tr>
				</thead>
				<tbody className=' divide-y divide-neutral-300'>
					{tableData.map((row) => (
						<TableRow key={row.id} row={row} />
					))}
				</tbody>
			</table>
		</div>
	)
}

export default TableRoot
