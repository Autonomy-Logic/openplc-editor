import { ColumnDef } from '@tanstack/react-table'
import { useState } from 'react'

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

const EditableCell: Partial<ColumnDef<IVariable>> = {
  cell: ({ getValue, row: { index }, column: { id }, table }) => {
    const [cellValue, setCellValue] = useState(initialValue)
    return (
      <InputWithRef
        value={cellValue}
        onChange={(e) => setCellValue(e.target.value)}
        className='h-full w-full bg-transparent'
      />
    )
  },
}

export { EditableCell }
