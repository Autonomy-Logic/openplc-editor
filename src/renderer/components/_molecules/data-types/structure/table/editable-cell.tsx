import * as PrimitivePopover from '@radix-ui/react-popover'
import { ProjectResponse } from '@root/renderer/store/slices/project'
import { PLCStructureVariable } from '@root/types/PLC/open-plc'
import { cn } from '@root/utils'
import type { CellContext, RowData } from '@tanstack/react-table'
import { useEffect, useState } from 'react'

import { InputWithRef } from '../../../../_atoms'
import { useToast } from '../../../../_features/[app]/toast/use-toast'

declare module '@tanstack/react-table' {
  // This is a helper interface that adds the `updateData` property to the table meta.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface TableMeta<TData extends RowData> {
    updateData: (rowIndex: number, columnId: string, value: unknown) => ProjectResponse
  }
}

type IEditableCellProps = CellContext<PLCStructureVariable, unknown> & { editable?: boolean }
const EditableNameCell = ({ getValue, row: { index }, column: { id }, table }: IEditableCellProps) => {
  const initialValue = getValue<string | undefined>()
  const { toast } = useToast()
  const [cellValue, setCellValue] = useState(initialValue)

  const onBlur = () => {
    const existingVariableNames = table
      .getRowModel()
      .rows.map((row) => row.original.name)
      .filter((name) => name !== initialValue) 

    const validateVariableName = (name: string, existingVariables: string[], currentName: string) => {
      if (!name.trim()) {
        return { valid: false, message: 'The name cannot be empty' }
      }

      if (name !== currentName && existingVariables.includes(name)) {
        return { valid: false, message: `The name '${name}' already exists` }
      }

      return { valid: true }
    }

    const validation = validateVariableName(cellValue ?? '', existingVariableNames, initialValue)

    if (!validation.valid) {
      toast({ title: 'Erro', description: validation.message, variant: 'fail' })
      setCellValue(initialValue)
      return
    }

    const res = table.options.meta?.updateData(index, id, cellValue)
    if (!res?.ok) {
      toast({ title: res?.title, description: res?.message, variant: 'fail' })
      setCellValue(initialValue)
    }
  }

  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])

  return (
    <InputWithRef
      value={cellValue}
      onChange={(e) => setCellValue(e.target.value)}
      onBlur={onBlur}
      className={cn('flex w-full flex-1 bg-transparent p-2 text-center outline-none')}
    />
  )
}

const EditableInitialValueCell = ({
  getValue,
  row: { index },
  column: { id },
  table,
  editable = true,
}: IEditableCellProps) => {
  const initialValue = getValue<PLCStructureVariable['initialValue'] | undefined>()

  const [cellValue, setCellValue] = useState(initialValue)

  const onBlur = () => {
    table.options.meta?.updateData(index, id, cellValue)
  }

  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])

  return (
    <PrimitivePopover.Root>
      <PrimitivePopover.Trigger asChild>
        <div
          className={cn('flex h-full w-full cursor-text items-center justify-center p-2', {
            'pointer-events-none': !editable,
          })}
        >
          <p className='h-4 w-full max-w-[400px] overflow-hidden text-ellipsis break-all'>
            {cellValue?.simpleValue?.value}
          </p>
        </div>
      </PrimitivePopover.Trigger>
      <PrimitivePopover.Portal>
        <PrimitivePopover.Content
          align='center'
          side='bottom'
          sideOffset={-32}
          className='box h-fit w-[175px] rounded-lg bg-white p-2 lg:w-[275px] 2xl:w-[375px] dark:bg-neutral-950'
          onInteractOutside={onBlur}
        >
          <textarea
            value={cellValue?.simpleValue?.value ?? ''}
            onChange={(e) => {
              setCellValue({
                ...cellValue,
                simpleValue: {
                  ...cellValue?.simpleValue,
                  value: e.target.value,
                },
              })
            }}
            rows={5}
            className='w-full max-w-[375px] flex-1 resize-none  bg-transparent text-start text-neutral-900 outline-none  dark:text-neutral-100'
          />
        </PrimitivePopover.Content>
      </PrimitivePopover.Portal>
    </PrimitivePopover.Root>
  )
}

export { EditableInitialValueCell, EditableNameCell }