import { useState } from 'react'
import { ArrowUp, MinusIcon, PlusIcon } from '@root/renderer/assets'
import { TableIcon } from '@root/renderer/assets/icons/interface/TableIcon'
import { CodeIcon } from '@root/renderer/assets/icons/interface/CodeIcon'

import { TableDisplay, CodeDisplay } from './data-display'
import { IVariableProps } from './types'

const Variables = () => {
	const [visibility, setVisibility] = useState<'code' | 'table'>('table')
	const [variablesData, setVariablesData] = useState<IVariableProps[]>([
		{
			id: 1,
			name: '',
			class: 'Input',
			type: 'Array',
			location: '',
			initialValue: '',
			debug: false,
			documentation: '',
		},
	])

	const addTableRow = () => {
		const newRow = { ...variablesData[0], id: variablesData.length + 1 }
		setVariablesData([...variablesData, newRow])
	}

	const removeTableRow = (idToRemove: number) => {
		setVariablesData(variablesData.filter((row) => row.id !== idToRemove))
	}
	return (
		<div id='Variables container'>
			<div
				id='Variables actions container'
				className='flex justify-between mb-4'
			>
				{visibility === 'table' && (
					<div id='Table actions' className='flex flex-1 justify-between'>
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
						<div className='flex gap-3 items-center'>
							<PlusIcon
								className='w-5 h-5 !stroke-brand'
								onClick={addTableRow}
							/>
							<MinusIcon
								className='w-5 h-5 stroke-brand'
								onClick={() => removeTableRow(variablesData.length)}
							/>
							<ArrowUp className='w-5 h-5 stroke-brand' />
							<ArrowUp className='w-5 h-5 stroke-brand rotate-180' />
						</div>
					</div>
				)}
				<div className='flex items-center rounded-md overflow-hidden relative h-full'>
					<TableIcon
						size='md'
						onClick={() => setVisibility('table')}
						currentVisible={visibility === 'table'}
					/>
					<CodeIcon
						size='md'
						onClick={() => setVisibility('code')}
						currentVisible={visibility === 'code'}
					/>
				</div>
			</div>
			<div id='Variables data'>
				{visibility === 'table' ? (
					<div
						id='Variables table root'
						className='w-full min-w-28 pb-2 pr-2 overflow-auto oplc-scrollbar'
					>
						<div
							id='Variable table container'
							className='w-full min-w-max flex flex-1 rounded-lg border border-neutral-500 dark:border-neutral-850'
						>
							<TableDisplay data={variablesData} />
						</div>
					</div>
				) : (
					<CodeDisplay />
				)}
			</div>
		</div>
	)
}

export { Variables }
