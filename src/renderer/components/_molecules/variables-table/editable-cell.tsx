import { type CellContext, RowData } from '@tanstack/react-table'
import { useEffect, useState } from 'react'

import { InputWithRef } from '../../_atoms'

type IVariable = {
  id: number
  name: string
  class: 'input' | 'output'
  type: 'BOOL' | 'INT' | 'DATE'
  location: string
  debug: boolean
  documentation: string
}

declare module '@tanstack/react-table' {
  // This is a helper interface that adds the `updateData` property to the table meta.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface TableMeta<TData extends RowData> {
    updateData: (rowIndex: number, columnId: string, value: unknown) => void
  }
}

type IEditableCellProps = CellContext<IVariable, unknown>
const EditableCell = ({ getValue, row: { index }, column: { id }, table }: IEditableCellProps) => {
  const initialValue = getValue()
  // We need to keep and update the state of the cell normally
  const [cellValue, setCellValue] = useState(initialValue)

  // When the input is blurred, we'll call our table meta's updateData function
  const onBlur = () => {
    // Todo: Must update the data in the store
    table.options.meta?.updateData(index, id, cellValue)
  }
  // If the initialValue is changed external, sync it up with our state
  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])

  return (
    <InputWithRef
      value={cellValue as string}
      onChange={(e) => setCellValue(e.target.value)}
      onBlur={onBlur}
      className='flex max-w-20 flex-1 bg-transparent outline-none'
    />
  )
}

export { EditableCell }
