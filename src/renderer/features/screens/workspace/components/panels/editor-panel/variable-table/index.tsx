import { useState } from 'react'
import { ArrowUp, MinusIcon, PlusIcon } from '@process:renderer/assets'
import TableRoot from './table'
import { TableIcon } from '@process:renderer/assets/icons/interface/TableIcon'
import { CodeIcon } from '@process:renderer/assets/icons/interface/CodeIcon'
import VariableCode from './variableCode'

const initialTableRow = {
	id: 1,
	name: '',
	class: classes,
	type: types,
	localization: '',
	initialValue: '',
	option: options,
	debug: '',
	documentation: '',
}

export default function VariableTable() {
	// const [variableAsCode, setVariableAsCode] = useState(false)
	// Todo
	const [tableData, setTableData] = useState([initialTableRow])

	// Todo
	// const addTableRow = () => {
	// 	const newRow = { ...initialTableRow, id: tableData.length + 1 }
	// 	setTableData([...tableData, newRow])
	// }

	// const removeTableRow = (idToRemove) => {
	// 	setTableData(tableData.filter((row) => row.id !== idToRemove))
	// }

	// Todo
	const toggleVariableDisplay = (variableAsTable) => {
		setVariableAsCode(!variableAsTable)
	}

	return (
		<>
			<div className='flex justify-between'>
				{!variableAsCode ? (
					<div className='flex gap-4'>
						<div className='flex gap-4 items-center text-neutral-1000 font-medium text-xs dark:text-neutral-300'>
							Description:
							<input className='px-2 focus:outline-none w-80 border dark:text-white border-neutral-100 rounded-lg bg-inherit h-8 font-medium text-[10px] text-neutral-850 ' />
						</div>
						<div className='flex gap-4 items-center text-neutral-1000 font-medium text-xs dark:text-neutral-300'>
							Class Filter:
							<select className='px-2 focus:outline-none dark:text-white w-48 border border-neutral-100 rounded-lg bg-inherit h-8 font-medium text-[10px] text-neutral-850 '>
								<option value='local'>Local</option>
							</select>
						</div>
					</div>
				) : (
					<div />
				)}
				<div className='flex gap-4'>
					{!variableAsCode ? (
						<div className='flex gap-3 items-center'>
							<PlusIcon
								className='w-5 h-5 !stroke-brand'
								onClick={addTableRow}
							/>
							<MinusIcon
								className='w-5 h-5 stroke-brand'
								onClick={() => removeTableRow(tableData.length)}
							/>
							<ArrowUp className='w-5 h-5 stroke-brand' />
							<ArrowUp className='w-5 h-5 stroke-brand rotate-180' />
						</div>
					) : null}
					<div className='flex items-center rounded-md overflow-hidden relative h-full'>
						<TableIcon
							size='md'
							onClick={() => toggleVariableDisplay(true)}
							variableAsTable={!variableAsCode}
						/>
						<CodeIcon
							size='md'
							onClick={() => toggleVariableDisplay(false)}
							variableAsCode={variableAsCode}
						/>
					</div>
				</div>
			</div>

			{!variableAsCode ? (
				<TableRoot tableData={tableData} optionsMock={optionsMock} />
			) : (
				<VariableCode />
			)}
		</>
	)
}
