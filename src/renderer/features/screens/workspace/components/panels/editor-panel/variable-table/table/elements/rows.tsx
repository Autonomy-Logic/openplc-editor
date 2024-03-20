import { cn } from '@utils/cn'
import RowDropdown from '../components/rowDropdown'

type ITableRowProps = {
	row: {
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
}
const TableRow = ({ row }: ITableRowProps) => {
	// const tdDefaultStyle =
	// 	'h-8 font-medium text-neutral-500 text-xs w-[10%] !min-w-[128px]'
	const selectDefaultStyle = 'w-full bg-inherit focus:outline-none text-center '

	return (
		<tr className='divide-x divide-y divide-neutral-300 dark:divide-neutral-850 *:h-8 font-medium text-neutral-500 text-xs w-[10%] !min-w-[128px]'>
			<td id='Variable id' className='w-[6%]'>
				<p className='text-neutral-400 text-center w-full'>{row.id}</p>
			</td>
			<td id='Variable name'>
				<input
					type='text'
					className={selectDefaultStyle}
					defaultValue={`localVar${row.id}`}
				/>
			</td>
			<td id='Variable class' className={`${tdDefaultStyle} `}>
				<RowDropdown rowData={row} value='class' />
			</td>

			<td id='Variable type' className={`${tdDefaultStyle} `}>
				<RowDropdown rowData={row} value='type' />
			</td>

			<td id='Variable location'>{/** Here goes the location */}</td>
			<td id='Variable initialValue'>
				<input type='text' className={selectDefaultStyle} />
			</td>
			<td id='Variable documentation'>
				<input type='text' className={selectDefaultStyle} />
			</td>
			<td id='Variable debug'>{/** Here goes the debug **/}</td>
		</tr>
	)
}

export default TableRow
