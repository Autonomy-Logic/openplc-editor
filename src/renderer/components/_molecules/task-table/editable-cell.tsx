import { WorkspaceResponse } from '@root/renderer/store/slices/workspace/types'
import type { PLCTask } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import type { CellContext, RowData } from '@tanstack/react-table'
import { useEffect, useState } from 'react'

import { InputWithRef } from '../../_atoms'
import { useToast } from '../../_features/[app]/toast/use-toast'
import ArrowButtonGroup from '../../_features/[workspace]/editor/graphical/elements/arrow-button-group'

declare module '@tanstack/react-table' {
  // This is a helper interface that adds the `updateData` property to the table meta.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface TableMeta<TData extends RowData> {
    updateData: (rowIndex: number, columnId: string, value: unknown) => WorkspaceResponse
  }
}

type IEditableCellProps = CellContext<PLCTask, unknown> & { editable?: boolean }

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

const EditablePriorityCell = ({
  getValue,
  row: { index },
  column: { id },
  table,
  editable = true,
}: IEditableCellProps) => {
  const initialValue = getValue<number>()
  const [cellValue, setCellValue] = useState<number>(initialValue)
  const [isFocused, setIsFocused] = useState(false)

  useEffect(() => {
    setCellValue(initialValue ?? 0)
  }, [initialValue])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Math.max(0, Math.min(99, Number(e.target.value)))
    setCellValue(value)
    table.options.meta?.updateData(index, id, value)
  }

  const onBlur = () => {
    const clampedValue = Math.max(0, Math.min(99, cellValue))
    setIsFocused(false)
    table.options.meta?.updateData(index, id, clampedValue)
  }

  const onFocus = () => {
    setIsFocused(true)
  }

  const handleIncrement = () => {
    const newValue = Math.min(99, cellValue + 1)
    setCellValue(newValue)
    table.options.meta?.updateData(index, id, newValue)
  }

  const handleDecrement = () => {
    const newValue = Math.max(0, cellValue - 1)
    setCellValue(newValue)
    table.options.meta?.updateData(index, id, newValue)
  }

  const preventBlurOnButtonClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
  }

  return (
    <div className='relative flex w-full items-center justify-center gap-2 px-2'>
      <InputWithRef
        placeholder='0-99'
        value={cellValue}
        onChange={handleChange}
        onBlur={onBlur}
        onFocus={onFocus}
        className={cn('flex w-full flex-1 bg-transparent p-2 text-center outline-none', {
          'pointer-events-none': !editable,
        })}
      />
      {isFocused && (
        <div className='absolute right-2' onMouseDown={preventBlurOnButtonClick}>
          <ArrowButtonGroup
            onIncrement={handleIncrement}
            onDecrement={handleDecrement}
            onMouseDown={preventBlurOnButtonClick}
          />
        </div>
      )}
    </div>
  )
}

export { EditableNameCell, EditablePriorityCell }
