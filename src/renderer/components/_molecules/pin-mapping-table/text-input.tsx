import { DevicePin } from '@root/renderer/store/slices'
import { CellContext } from '@tanstack/react-table'
import { useEffect, useState } from 'react'

import { GenericTextCell } from '../../_atoms'
import { toast } from '../../_features/[app]/toast/use-toast'

type PinTextInputCellProps = CellContext<DevicePin, unknown> & { selected?: boolean; editable?: boolean }
export const PinTextInputCell = ({
  getValue,
  row: { index },
  column: { id },
  table,
  selected = false,
  editable = true,
}: PinTextInputCellProps) => {
  const initialValue = getValue<string>()
  const [cellValue, setCellValue] = useState(initialValue)

  const onBlur = () => {
    if (cellValue === initialValue) return

    const res = table.options.meta?.updateData(index, id, cellValue)
    if (res?.ok) return

    setCellValue(initialValue)
    toast({ title: res?.title, description: res?.message, variant: 'fail' })
  }

  // If the initialValue is changed external, sync it up with our state
  useEffect(() => {
    console.log('PinTextInputCell useEffect', { initialValue, cellValue })
    setCellValue(initialValue)
  }, [initialValue])

  return (
    <GenericTextCell
      value={cellValue}
      onChange={setCellValue}
      onBlur={onBlur}
      editable={editable}
      selected={selected}
    />
  )
}
