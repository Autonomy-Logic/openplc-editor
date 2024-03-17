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
	const tdDefaultStyle =
		'h-8  font-medium text-neutral-500 text-xs w-[10%] !min-w-[128px]'
	const selectDefaultStyle = 'w-full bg-inherit focus:outline-none text-center '

	return (
		<tr className=' divide-x divide-neutral-300 '>
			<td className={cn(tdDefaultStyle, 'w-[6%]')}>
				<p className='text-neutral-400 text-center w-full'>{row.id}</p>
			</td>
			<td className={tdDefaultStyle}>
				<input
					type='text'
					className={selectDefaultStyle}
					defaultValue={`localVar${row.id}`}
				/>
			</td>
			<td className={`${tdDefaultStyle} `}>
				<RowDropdown rowData={row} value='class' />
			</td>

			<td className={`${tdDefaultStyle} `}>
				<RowDropdown rowData={row} value='type' />
			</td>

			<td className={tdDefaultStyle} />
			<td className={tdDefaultStyle}>
				<input
					placeholder='initial value'
					type='text'
					className={selectDefaultStyle}
				/>
			</td>
			<td className={`${tdDefaultStyle}`}>
				<RowDropdown rowData={row} value='option' />
			</td>
			<td className={tdDefaultStyle} />
			<td className={tdDefaultStyle}>
				<input type='text' className={selectDefaultStyle} />
			</td>
		</tr>
	)
}

export default TableRow
