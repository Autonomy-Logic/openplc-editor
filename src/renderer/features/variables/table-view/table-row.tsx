import { ComponentProps } from 'react'
import { IVariableClass, IVariableType } from '../data'
import RowDropdown from '../../screens/workspace/components/panels/editor-panel/variable-table/table/components/rowDropdown'

export type IVariableProps = {
	id: string
	name: string
	class: IVariableClass
	type: IVariableType
	location: string
	initialValue: string
	documentation: string
	debug: boolean
}

type ITableRowProps = ComponentProps<'tr'> & {
	data: IVariableProps
}

const VariablesTableRow = (props: ITableRowProps) => {
	const { data, ...res } = props
	const selectDefaultStyle = 'w-full bg-inherit focus:outline-none text-center '

	return (
		<tr
			className='divide-x divide-y divide-neutral-300 dark:divide-neutral-850 *:h-8 font-medium text-neutral-500 text-xs w-[10%] !min-w-[128px]'
			{...res}
		>
			<td id='Variable id' className='w-[6%]'>
				<p className='text-neutral-400 text-center w-full'>{data.id}</p>
			</td>
			<td id='Variable name'>
				<input
					type='text'
					className={selectDefaultStyle}
					defaultValue={`localVar${data.id}`}
				/>
			</td>
			<td id='Variable class'>
				<RowDropdown rowData={data} value='class' />
			</td>

			<td id='Variable type'>
				<RowDropdown rowData={data} value='type' />
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

export { VariablesTableRow }
