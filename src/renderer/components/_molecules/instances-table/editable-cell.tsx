import { ProjectResponse } from '@root/renderer/store/slices/project'
import type { PLCInstance } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import type { CellContext, RowData } from '@tanstack/react-table'
import { useEffect, useState } from 'react'

import { InputWithRef } from '../../_atoms'
import { useToast } from '../../_features/[app]/toast/use-toast'

declare module '@tanstack/react-table' {
  // This is a helper interface that adds the `updateData` property to the table meta.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface TableMeta<TData extends RowData> {
    updateData: (rowIndex: number, columnId: string, value: unknown) => ProjectResponse
  }
}

type IEditableCellProps = CellContext<PLCInstance, unknown> & { editable?: boolean }

const EditableNameCell = ({ getValue, row: { index }, column: { id }, table, editable = true }: IEditableCellProps) => {
  const initialValue = getValue<string>()
  const { toast } = useToast()
  const [cellValue, setCellValue] = useState(initialValue)

  const onBlur = () => {
    if (cellValue === initialValue) return

    const res = table.options.meta?.updateData(index, id, cellValue)

    if (res?.ok) return

    setCellValue(initialValue)
    toast({ title: res?.title, description: res?.message, variant: 'fail' })
  }

  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])

  return (
    <InputWithRef
      value={cellValue}
      onChange={(e) => setCellValue(e.target.value)}
      onBlur={onBlur}
      className={cn('flex w-full flex-1 bg-transparent p-2 text-center outline-none', {
        'pointer-events-none': !editable,
      })}
    />
  )
}

export default EditableNameCell
