import { CellContext } from '@tanstack/react-table'
import { startCase } from 'lodash'
import { useCallback, useEffect, useState } from 'react'

import type { DevicePin, PinType } from '../../../../middleware/shared/ports/types'
import { GenericSelectCell } from '../../_atoms/generic-table-inputs/generic-select-cell'
import { toast } from '../../_features/[app]/toast/use-toast'

const pinTypes: PinType[] = ['digitalInput', 'digitalOutput', 'analogInput', 'analogOutput']

type PinSelectInputCellProps = CellContext<DevicePin, unknown> & {
  selected?: boolean
  editable?: boolean
}
export const PinSelectInputCell = ({
  getValue,
  row: { index },
  column: { id },
  table,
  selected = false,
}: PinSelectInputCellProps) => {
  const initialValue = getValue<string>()
  const [cellValue, setCellValue] = useState(initialValue)

  const onValueChange = (value: string) => {
    if (value === initialValue) return

    const res = table.options.meta?.updateData(index, id, value)

    // Assume success when no structured response is returned
    if (res === undefined || res?.ok) return

    setCellValue(initialValue)
    toast({ title: res?.title, description: res?.message, variant: 'fail' })
  }

  const selectableValues = useCallback(() => {
    if (id === 'pinType') {
      return Object.values(pinTypes).map((value) => ({
        id: value,
        value: value,
        label: startCase(value),
      }))
    }

    return []
  }, [id])

  // If the initialValue is changed external, sync it up with our state
  useEffect(() => {
    setCellValue(initialValue)
  }, [initialValue])

  return (
    <GenericSelectCell
      value={cellValue}
      onValueChange={onValueChange}
      selectValues={selectableValues()}
      selected={selected}
    />
  )
}
