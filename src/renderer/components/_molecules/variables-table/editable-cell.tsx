import * as PrimitivePopover from '@radix-ui/react-popover'
import type { PLCVariable } from '@root/types/PLC/test'
import { type CellContext, RowData } from '@tanstack/react-table'
import { useEffect, useState } from 'react'

import { InputWithRef } from '../../_atoms'

declare module '@tanstack/react-table' {
  // This is a helper interface that adds the `updateData` property to the table meta.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface TableMeta<TData extends RowData> {
    updateData: (rowIndex: number, columnId: string, value: unknown) => void
  }
}

type EditableCellProps = CellContext<PLCVariable, unknown>
const EditableNameCell = ({ getValue, row: { index }, column: { id }, table }: EditableCellProps) => {
  const initialValue = getValue<string>()
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
      value={cellValue}
      onChange={(e) => setCellValue(e.target.value)}
      onBlur={onBlur}
      className='flex w-full max-w-[400px] flex-1 bg-transparent text-center outline-none'
    />
  )
}

const EditableDocumentationCell = ({ getValue, row: { index }, column: { id }, table }: EditableCellProps) => {
  const initialValue = getValue<string | undefined>()
  // We need to keep and update the state of the cell normally
  const [cellValue, setCellValue] = useState(initialValue ?? '')

  // When the input is blurred, we'll call our table meta's updateData function
  const onBlur = () => {
    // Todo: Must update the data in the store
    table.options.meta?.updateData(index, id, cellValue)
  }
  // If the initialValue is changed external, sync it up with our state
  useEffect(() => {
    if (initialValue) setCellValue(initialValue)
  }, [initialValue])

  return (
    <PrimitivePopover.Root>
      <PrimitivePopover.Trigger asChild>
        <div className='flex h-full w-full cursor-text items-center justify-center'>
          <p className='h-4 w-full max-w-[400px] overflow-hidden text-ellipsis break-all'>{cellValue}</p>
        </div>
      </PrimitivePopover.Trigger>
      <PrimitivePopover.Portal>
        <PrimitivePopover.Content
          align='center'
          side='bottom'
          sideOffset={-32}
          className='h-fit w-[175px] rounded-lg bg-white p-2 drop-shadow-lg lg:w-[275px] 2xl:w-[375px] dark:bg-neutral-950'
        >
          <textarea
            value={cellValue}
            onChange={(e) => setCellValue(e.target.value)}
            onBlur={onBlur}
            rows={5}
            className='w-full max-w-[375px] flex-1 resize-none bg-transparent text-start text-neutral-900 outline-none dark:text-neutral-100'
          />
        </PrimitivePopover.Content>
      </PrimitivePopover.Portal>
    </PrimitivePopover.Root>
  )
}

export { EditableDocumentationCell, EditableNameCell }
