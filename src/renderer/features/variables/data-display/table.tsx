import { ComponentProps } from 'react'

import { IVariableProps } from '../types'

type ITableDisplayProps = ComponentProps<'table'> & {
  data: IVariableProps[]
}

type ITableHeaderCellProps = ComponentProps<'th'> & {
  label: string
}

type ITableDataRowProps = ComponentProps<'tr'> & {
  variable: IVariableProps
}
const TableHeaderCell = (props: ITableHeaderCellProps) => {
  const { label, ...res } = props
  return (
    <th
      id='Table header cell'
      className='h-8 px-4 py-2 text-center text-neutral-850 font-medium text-xs dark:text-neutral-300'
      {...res}
    >
      {label}
    </th>
  )
}

const TableDataRow = (props: ITableDataRowProps) => {
  const { variable, ...res } = props
  return (
    <tr
      className='divide-x divide-y divide-neutral-300 dark:divide-neutral-850
			first:w-[6%]
			*:h-8 *:font-medium *:text-neutral-500 *:text-xs *:w-[10%] *:!min-w-[128px]'
      {...res}
    >
      <td id='Variable id'>
        <p className='text-neutral-400 text-center w-full'>{variable.id}</p>
      </td>
      <td id='Variable name'>
        <input
          type='text'
          className='w-full bg-inherit focus:outline-none text-center'
          defaultValue={`localVar${variable.id}`}
        />
      </td>
      <td id='Variable class'>
        <span>{variable.class}</span>
      </td>

      <td id='Variable type'>
        <span>{variable.type}</span>
      </td>

      <td id='Variable location'>{/** Here goes the location */}</td>
      <td id='Variable initialValue'>
        <input type='text' className='w-full bg-inherit focus:outline-none text-center' />
      </td>
      <td id='Variable documentation'>
        <input type='text' className='w-full bg-inherit focus:outline-none text-center' />
      </td>
      <td id='Variable debug'>{/** Here goes the debug **/}</td>
    </tr>
  )
}

const TableDisplay = (props: ITableDisplayProps) => {
  const { data, ...res } = props
  return (
    <table id='Variable table' className='w-full flex-1' {...res}>
      <thead id='Variable table header container' className='border-b border-neutral-300 dark:border-neutral-850 '>
        <tr id='Variable table header row' className='divide-x divide-neutral-300 dark:divide-neutral-850'>
          <TableHeaderCell label='#' />
          <TableHeaderCell label='Name' />
          <TableHeaderCell label='Class' />
          <TableHeaderCell label='Type' />
          <TableHeaderCell label='Location' />
          <TableHeaderCell label='Initial value' />
          <TableHeaderCell label='Debug' />
          <TableHeaderCell label='Documentation' />
        </tr>
      </thead>
      <tbody id='Variable table body' className='divide-y divide-x divide-neutral-300 dark:divide-neutral-850'>
        {data.map((variable) => (
          <TableDataRow key={variable.id} variable={variable} />
        ))}
      </tbody>
    </table>
  )
}

export { TableDisplay }
